import type { ScryCard } from './types'
import { cardOracle } from './scryfall'

// Rulebreaker (Mystery Booster Commander Edition) is the first keyword that lets
// a deck contain cards outside its commander's color identity. Every printing
// spells the exception out in prose, and the prose varies — some grant a card
// class ("Phyrexian cards"), one grants a single extra color for a class
// (Tolabow), one unlocks the whole mana base (Grizzlegom), and one drops the
// deck-size limit entirely (Whtz). Rather than hardcode the twelve known cards,
// this module parses the clause, so cards printed after this was written still
// work as long as they reuse the established templating.

export type GrantScope = 'any' | 'splash'

export const WUBRG = ['W', 'U', 'B', 'R', 'G']

/** The player's choices about how to use a commander's Rulebreaker clauses. */
export interface RulebreakerChoices {
  /** Chosen extra color for a "one color of your choice" clause. */
  splash?: string | null
  /**
   * Colors permitted for "any color identity" grants. `null`/undefined means
   * unrestricted, which is what the card actually says; narrowing it is a
   * deckbuilding preference that keeps the mana base honest.
   */
  colors?: string[] | null
}

/** Treats "every color selected" as no restriction at all. */
export function normalizeChoices(choices?: RulebreakerChoices | null): RulebreakerChoices {
  const colors = choices?.colors
  return {
    splash: choices?.splash ?? null,
    colors: !colors || WUBRG.every((c) => colors.includes(c)) ? null : colors,
  }
}

/** One "cards matching X ignore color identity" clause. */
export interface RulebreakerGrant {
  /** The parsed card class, e.g. `Phyrexian cards` — shown in the UI. */
  label: string
  /** Scryfall clause selecting the exempt cards, e.g. `t:phyrexian`. */
  query: string
  /** Local mirror of `query`, for re-checking cards we already hold. */
  matches: (card: ScryCard) => boolean
  /**
   * `any` — exempt cards may have any color identity at all.
   * `splash` — exempt cards may use one extra color of the player's choice.
   */
  scope: GrantScope
}

export interface RulebreakerMode {
  /** Commanders that contributed a clause, for display. */
  sources: string[]
  /** The raw Rulebreaker clauses, for display. */
  text: string[]
  grants: RulebreakerGrant[]
  /** Basic lands outside the color identity are legal. */
  anyBasicLands: boolean
  /** Any land card is legal regardless of color identity (Grizzlegom). */
  anyLands: boolean
  /** The deck has no maximum size (Whtz, the Bibliophile). */
  noMaxDeckSize: boolean
  /** True when a `splash` grant is present and the player must pick a color. */
  needsSplashColor: boolean
}

const RULEBREAKER_CLAUSE = /^Rulebreaker\s*[—–-]\s*(.+)$/gm

// The three sentence templates used across the cycle. Each captures the card
// class the exception applies to.
const GRANT_PATTERNS: { re: RegExp; scope: GrantScope }[] = [
  // "A deck with this commander can have Phyrexian cards of any color identity"
  { re: /can have (.+?) of any color identity/i, scope: 'any' },
  // "you may include legendary permanents of any color in your deck regardless
  //  of color identity" / "...include all artifacts and enchantments in your deck..."
  {
    re: /you may include (.+?)(?: of any color)? in your deck regardless of color identity/i,
    scope: 'any',
  },
  // "the color identity of instant and sorcery cards in your deck can include
  //  one color of your choice not in your commander's color identity"
  {
    re: /the color identity of (.+?) in your deck can include one color of your choice/i,
    scope: 'splash',
  },
]

/** Supertypes/types/subtypes map to `t:`; "permanent" is a Scryfall `is:` check. */
function typeClause(word: string): { query: string; test: (typeLine: string) => boolean } {
  if (word === 'permanent') {
    return {
      query: 'is:permanent',
      test: (t) => /\b(Artifact|Creature|Enchantment|Land|Planeswalker|Battle)\b/i.test(t),
    }
  }
  return {
    query: `t:${word}`,
    test: (t) => new RegExp(`\\b${word}\\b`, 'i').test(t),
  }
}

function singularize(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.endsWith('ss') || word.endsWith('us')) return word
  return word.endsWith('s') ? word.slice(0, -1) : word
}

interface Numeric {
  query: string
  test: (card: ScryCard) => boolean
}

/** Pulls "with mana value 7 or greater" / "of power 4 or greater" off the phrase. */
function extractNumerics(phrase: string): { rest: string; numerics: Numeric[] } {
  const numerics: Numeric[] = []
  let rest = phrase
  const dims: { name: string; field: string; value: (c: ScryCard) => number }[] = [
    { name: 'mana value', field: 'mv', value: (c) => c.cmc },
    { name: 'power', field: 'pow', value: (c) => Number(c.power) },
    { name: 'toughness', field: 'tou', value: (c) => Number(c.toughness) },
  ]
  for (const dim of dims) {
    const re = new RegExp(
      `\\b(?:with|of)\\s+${dim.name}\\s+(\\d+)\\s+or\\s+(greater|less)\\b`,
      'i'
    )
    const match = rest.match(re)
    if (!match) continue
    const n = Number(match[1])
    const greater = match[2].toLowerCase() === 'greater'
    numerics.push({
      query: `${dim.field}${greater ? '>=' : '<='}${n}`,
      test: (card) => {
        const v = dim.value(card)
        return Number.isFinite(v) && (greater ? v >= n : v <= n)
      },
    })
    rest = rest.replace(re, ' ')
  }
  return { rest, numerics }
}

/**
 * Turns a card-class phrase ("artifact creature and Equipment cards") into a
 * Scryfall clause plus a local predicate. Terms are OR'd; words inside a term
 * are AND'd, matching how the cards read.
 */
function compileClass(phrase: string): Pick<RulebreakerGrant, 'query' | 'matches'> | null {
  const { rest, numerics } = extractNumerics(phrase.toLowerCase().trim())
  const cleaned = rest
    .replace(/^all\s+/, '')
    .replace(/\bcards?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null

  const terms = cleaned
    .split(/\s+(?:and|or)\s+/)
    .map((term) => term.split(/\s+/).map(singularize).filter(Boolean))
    .filter((words) => words.length > 0)
  if (terms.length === 0) return null

  const compiled = terms.map((words) => words.map(typeClause))
  const typeQuery = compiled
    .map((clauses) => clauses.map((c) => c.query).join(' '))
    .join(' or ')
  const query = [compiled.length > 1 ? `(${typeQuery})` : typeQuery, ...numerics.map((n) => n.query)]
    .filter(Boolean)
    .join(' ')

  return {
    query,
    matches: (card) => {
      const typeLine = card.type_line ?? ''
      const typeOk = compiled.some((clauses) => clauses.every((c) => c.test(typeLine)))
      return typeOk && numerics.every((n) => n.test(card))
    },
  }
}

/** Reads a single card's Rulebreaker clauses. Returns null for normal cards. */
export function rulebreakerMode(card: ScryCard): RulebreakerMode | null {
  if (!(card.keywords ?? []).some((k) => k.toLowerCase() === 'rulebreaker')) return null
  const clauses = [...cardOracle(card).matchAll(RULEBREAKER_CLAUSE)].map((m) => m[1].trim())
  if (clauses.length === 0) return null

  const mode: RulebreakerMode = {
    sources: [card.name],
    text: clauses,
    grants: [],
    anyBasicLands: false,
    anyLands: false,
    noMaxDeckSize: false,
    needsSplashColor: false,
  }

  for (const clause of clauses) {
    if (/no maximum deck size/i.test(clause)) mode.noMaxDeckSize = true
    // "can have any land cards" — the whole mana base, not just basics.
    if (/\b(?:have|include) any land cards?\b/i.test(clause)) mode.anyLands = true
    if (/\bany basic land cards?\b/i.test(clause)) mode.anyBasicLands = true

    for (const { re, scope } of GRANT_PATTERNS) {
      const phrase = clause.match(re)?.[1]?.trim()
      if (!phrase) continue
      const compiled = compileClass(phrase)
      if (!compiled) continue
      mode.grants.push({ label: phrase, scope, ...compiled })
      break
    }
  }

  if (mode.anyLands) mode.anyBasicLands = true
  mode.needsSplashColor = mode.grants.some((g) => g.scope === 'splash')
  if (
    mode.grants.length === 0 &&
    !mode.anyBasicLands &&
    !mode.anyLands &&
    !mode.noMaxDeckSize
  ) {
    // Keyword present but the wording is one we don't understand. Surfacing the
    // text is still useful; silently widening the pool would not be.
    return mode
  }
  return mode
}

/** Merges the commander's and partner's clauses. */
export function combineRulebreakers(
  commander: ScryCard,
  partner?: ScryCard | null
): RulebreakerMode | null {
  const modes = [rulebreakerMode(commander), partner ? rulebreakerMode(partner) : null].filter(
    (m): m is RulebreakerMode => !!m
  )
  if (modes.length === 0) return null
  if (modes.length === 1) return modes[0]
  return {
    sources: modes.flatMap((m) => m.sources),
    text: modes.flatMap((m) => m.text),
    grants: modes.flatMap((m) => m.grants),
    anyBasicLands: modes.some((m) => m.anyBasicLands),
    anyLands: modes.some((m) => m.anyLands),
    noMaxDeckSize: modes.some((m) => m.noMaxDeckSize),
    needsSplashColor: modes.some((m) => m.needsSplashColor),
  }
}

function isLand(card: ScryCard): boolean {
  return /\bLand\b/i.test(card.type_line ?? '')
}

function isBasicLand(card: ScryCard): boolean {
  return isLand(card) && /\bBasic\b/i.test(card.type_line ?? '')
}

function within(card: ScryCard, colors: Set<string>): boolean {
  return card.color_identity.every((c) => colors.has(c))
}

/**
 * True when a Rulebreaker clause makes `card` legal despite falling outside the
 * commander's printed identity. Callers still check the identity themselves.
 */
export function rulebreakerAllows(
  mode: RulebreakerMode | null | undefined,
  card: ScryCard,
  identity: string[],
  choices?: RulebreakerChoices | null
): boolean {
  if (!mode) return false
  const { splash, colors } = normalizeChoices(choices)
  if (isLand(card)) {
    if (mode.anyLands) return true
    if (mode.anyBasicLands && isBasicLand(card)) return true
  }
  for (const grant of mode.grants) {
    if (!grant.matches(card)) continue
    if (grant.scope === 'any') {
      if (!colors) return true
      if (within(card, new Set([...identity, ...colors]))) return true
    } else if (splash && within(card, new Set([...identity, splash]))) {
      return true
    }
  }
  return false
}

/**
 * Scryfall clauses to OR against `id<=...` so the search side matches
 * `rulebreakerAllows`.
 */
export function rulebreakerClauses(
  mode: RulebreakerMode | null | undefined,
  identity: string[],
  choices?: RulebreakerChoices | null
): string[] {
  if (!mode) return []
  const { splash, colors } = normalizeChoices(choices)
  const idOf = (extra: string[]) => {
    const set = new Set([...identity, ...extra])
    return WUBRG.filter((c) => set.has(c)).join('').toLowerCase() || 'c'
  }
  const out: string[] = []
  if (mode.anyLands) out.push('t:land')
  else if (mode.anyBasicLands) out.push('(t:basic t:land)')
  for (const grant of mode.grants) {
    if (grant.scope === 'any') {
      out.push(colors ? `(${grant.query} id<=${idOf(colors)})` : `(${grant.query})`)
    } else if (splash) {
      out.push(`(${grant.query} id<=${idOf([splash])})`)
    }
  }
  return out
}

/**
 * The full Scryfall color-identity constraint for a deck: the commander's own
 * colors OR'd with any Rulebreaker exceptions. Shared by the generator and the
 * card pickers so search and validation agree.
 */
export function identityClause(
  identity: string[],
  mode: RulebreakerMode | null | undefined,
  choices?: RulebreakerChoices | null
): string {
  const id = identity.length ? identity.join('').toLowerCase() : 'c'
  const extra = rulebreakerClauses(mode, identity, choices)
  return extra.length ? `(id<=${id} or ${extra.join(' or ')})` : `id<=${id}`
}

/** Colors the player can splash, i.e. everything outside the printed identity. */
export function splashOptions(identity: string[]): string[] {
  const id = new Set(identity)
  return WUBRG.filter((c) => !id.has(c))
}

/** Extra colors the deck can actually cast, used to widen the mana base. */
export function effectiveManaColors(
  mode: RulebreakerMode | null | undefined,
  identity: string[],
  choices?: RulebreakerChoices | null
): string[] {
  const splash = normalizeChoices(choices).splash
  const set = new Set(identity)
  if (mode && splash && mode.needsSplashColor) set.add(splash)
  return WUBRG.filter((c) => set.has(c))
}
