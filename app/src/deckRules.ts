import type { ScryCard } from './types'

// User-authored "Card Rules" — Scryfall search syntax that constrains which cards
// may enter a generated deck. See https://scryfall.com/docs/syntax
//
// Two consumers:
//   1. rulesToQuery()    — appended to Scryfall search queries so pool fetches are
//                          filtered server-side by Scryfall itself.
//   2. cardMatchesRules() — a local evaluator for cards that never touch a search
//                          query (EDHREC recommendations resolved by name).
//
// The evaluator implements the full grammar (AND/OR/negation/nesting/regex/exact
// names) and every keyword derivable from a card object. A handful of keywords
// need data no single card carries — print history (`in:`, `new:`, `prints`),
// Tagger data (`otag:`, `art:`), curated lists (`cube:`, land cycles) — and those
// evaluate to `unknown`, which never drops a card locally. `unsupportedRuleKeys()`
// reports them so callers can fall back to Scryfall; see resolveRuleWhitelist().

export type Tri = true | false | 'unknown'

type Node =
  | { kind: 'and'; nodes: Node[] }
  | { kind: 'or'; nodes: Node[] }
  | { kind: 'not'; node: Node }
  | { kind: 'term'; key: string; op: string; value: string; regex: boolean; exact: boolean }

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

interface Lexeme {
  text: string
  kind: 'word' | 'lparen' | 'rparen' | 'or' | 'and'
}

function lex(input: string): Lexeme[] {
  const out: Lexeme[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '(') {
      out.push({ text: '(', kind: 'lparen' })
      i++
      continue
    }
    if (ch === ')') {
      out.push({ text: ')', kind: 'rparen' })
      i++
      continue
    }
    // A bare term runs to the next space/paren, but quoted sections and /regex/
    // sections swallow whatever is inside them, spaces and parens included.
    let text = ''
    while (i < input.length && !/[\s()]/.test(input[i])) {
      if (input[i] === '"') {
        text += input[i++]
        while (i < input.length && input[i] !== '"') text += input[i++]
        if (i < input.length) text += input[i++]
        continue
      }
      if (input[i] === '/' && text.includes(':')) {
        text += input[i++]
        while (i < input.length && !(input[i] === '/' && input[i - 1] !== '\\')) text += input[i++]
        if (i < input.length) text += input[i++]
        continue
      }
      text += input[i++]
    }
    if (!text) {
      i++
      continue
    }
    const lower = text.toLowerCase()
    if (lower === 'or') out.push({ text, kind: 'or' })
    else if (lower === 'and') out.push({ text, kind: 'and' })
    else out.push({ text, kind: 'word' })
  }
  return out
}

const COMPARATORS = ['<=', '>=', '!=', '<', '>', '=', ':']

function parseTerm(raw: string): Node {
  let text = raw
  let negate = false
  while (text.startsWith('-')) {
    negate = !negate
    text = text.slice(1)
  }
  let exact = false
  if (text.startsWith('!')) {
    exact = true
    text = text.slice(1)
  }

  let key = ''
  let op = ''
  let value = text
  let at = -1
  for (const c of COMPARATORS) {
    const idx = text.indexOf(c)
    if (idx > 0 && (at === -1 || idx < at || (idx === at && c.length > op.length))) {
      at = idx
      op = c
      key = text.slice(0, idx)
      value = text.slice(idx + c.length)
    }
  }

  let regex = false
  if (value.length > 1 && value.startsWith('/') && value.endsWith('/')) {
    regex = true
    value = value.slice(1, -1)
  } else {
    value = value.replace(/^"(.*)"$/s, '$1')
  }

  // `not:` is Scryfall's inverted `is:`.
  let k = key.toLowerCase()
  if (k === 'not') {
    k = 'is'
    negate = !negate
  }
  const node: Node = { kind: 'term', key: k, op, value, regex, exact }
  return negate ? { kind: 'not', node } : node
}

function parse(input: string): Node {
  const lexemes = lex(input)
  let pos = 0

  const parsePrimary = (): Node | null => {
    const lx = lexemes[pos]
    if (!lx) return null
    if (lx.kind === 'lparen') {
      pos++
      const inner = parseOr()
      if (lexemes[pos]?.kind === 'rparen') pos++
      return inner
    }
    if (lx.kind === 'rparen') return null
    pos++
    return parseTerm(lx.text)
  }

  const parseAnd = (): Node => {
    const nodes: Node[] = []
    while (pos < lexemes.length) {
      const lx = lexemes[pos]
      if (lx.kind === 'rparen') break
      if (lx.kind === 'or') break
      if (lx.kind === 'and') {
        pos++
        continue
      }
      const node = parsePrimary()
      if (!node) break
      nodes.push(node)
    }
    return nodes.length === 1 ? nodes[0] : { kind: 'and', nodes }
  }

  const parseOr = (): Node => {
    const nodes: Node[] = [parseAnd()]
    while (lexemes[pos]?.kind === 'or') {
      pos++
      nodes.push(parseAnd())
    }
    return nodes.length === 1 ? nodes[0] : { kind: 'or', nodes }
  }

  return parseOr()
}

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------

const faces = (card: ScryCard) => card.card_faces ?? []
const lower = (s: string | undefined) => (s ?? '').toLowerCase()

function typeLine(card: ScryCard): string {
  return lower([card.type_line, ...faces(card).map((f) => f.type_line)].filter(Boolean).join(' // '))
}

function oracleText(card: ScryCard): string {
  const parts = [card.oracle_text ?? '', ...faces(card).map((f) => f.oracle_text ?? '')]
  return lower(parts.filter(Boolean).join('\n'))
}

/**
 * The names a card refers to itself by in rules text: the full name, the face
 * names, the short name before the comma ("Alrund" for "Alrund, God of the
 * Cosmos"), and the un-prefixed form of an Alchemy rebalance ("A-Acererak…").
 */
function selfNames(card: ScryCard): string[] {
  const raw = [card.name, ...card.name.split(' // '), ...faces(card).map((f) => f.name)]
  const out = new Set<string>()
  for (const n of raw) {
    if (!n) continue
    const plain = n.replace(/^A-/, '')
    out.add(lower(plain))
    const short = plain.split(',')[0].trim()
    if (short) out.add(lower(short))
  }
  return [...out].sort((a, b) => b.length - a.length)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Oracle text with `~` expanded to the card's name, as Scryfall's `o:` does. */
function oracleForMatch(card: ScryCard, value: string): { text: string; needle: string; asRegex: boolean } {
  const text = oracleText(card)
  if (!value.includes('~')) return { text, needle: value, asRegex: false }
  const alternation = `(?:${selfNames(card).map(escapeRe).join('|')})`
  return { text, needle: escapeRe(value).split('~').join(alternation), asRegex: true }
}

function flavorText(card: ScryCard): string {
  return lower([card.flavor_text ?? '', ...faces(card).map((f) => f.flavor_text ?? '')].join('\n'))
}

function artists(card: ScryCard): string {
  return lower([card.artist ?? '', ...faces(card).map((f) => f.artist ?? '')].join(' '))
}

function watermarks(card: ScryCard): string {
  return lower([card.watermark ?? '', ...faces(card).map((f) => f.watermark ?? '')].join(' '))
}

/**
 * Scryfall matches a multi-faced card when *any* face matches, so face-scoped
 * properties are evaluated per face rather than merged. Each view falls back to
 * the card-level value, which is where split/adventure cards keep their colours.
 */
interface FaceView {
  colors: Set<string>
  indicator: string[]
  mana: string
  power: string | undefined
  toughness: string | undefined
  loyalty: string | undefined
  defense: string | undefined
}

function faceViews(card: ScryCard): FaceView[] {
  const list = faces(card)
  const upper = (c: string[] | undefined) => new Set((c ?? []).map((x) => x.toUpperCase()))
  if (!list.length) {
    return [{
      colors: upper(card.colors),
      indicator: card.color_indicator ?? [],
      mana: lower(card.mana_cost),
      power: card.power,
      toughness: card.toughness,
      loyalty: card.loyalty,
      defense: card.defense,
    }]
  }
  return list.map((f) => ({
    colors: upper(f.colors ?? card.colors),
    indicator: f.color_indicator ?? card.color_indicator ?? [],
    mana: lower(f.mana_cost ?? card.mana_cost),
    power: f.power ?? card.power,
    toughness: f.toughness ?? card.toughness,
    loyalty: f.loyalty ?? card.loyalty,
    defense: f.defense ?? card.defense,
  }))
}

function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null
  const n = parseFloat(String(raw).replace(/[*+]/g, '') || '0')
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COLOR_WORDS: Record<string, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  w: 'W', u: 'U', b: 'B', r: 'R', g: 'G',
}

const COLOR_NICKNAMES: Record<string, string> = {
  // Guilds
  azorius: 'WU', dimir: 'UB', rakdos: 'BR', gruul: 'RG', selesnya: 'GW',
  orzhov: 'WB', izzet: 'UR', golgari: 'BG', boros: 'RW', simic: 'GU',
  // Shards
  bant: 'GWU', esper: 'WUB', grixis: 'UBR', jund: 'BRG', naya: 'RGW',
  // Wedges
  abzan: 'WBG', jeskai: 'URW', sultai: 'BGU', mardu: 'RWB', temur: 'GUR',
  // Colleges (Strixhaven)
  lorehold: 'RW', prismari: 'UR', quandrix: 'GU', silverquill: 'WB', witherbloom: 'BG',
  // Four-colour nicknames
  chaos: 'UBRG', aggression: 'BRGW', altruism: 'RGWU', growth: 'GWUB', artifice: 'WUBR',
  // Five
  wubrg: 'WUBRG', rainbow: 'WUBRG', fivecolor: 'WUBRG',
}

function colorLetters(value: string): Set<string> | null {
  const v = value.toLowerCase()
  if (v === 'c' || v === 'colorless') return new Set()
  if (v in COLOR_NICKNAMES) return new Set(COLOR_NICKNAMES[v].split(''))
  if (v in COLOR_WORDS) return new Set([COLOR_WORDS[v]])
  const set = new Set<string>()
  for (const ch of v.toUpperCase()) {
    if ('WUBRG'.includes(ch)) set.add(ch)
    else if (ch !== 'C') return null
  }
  return set
}

const isSuperset = (a: Set<string>, b: Set<string>) => [...b].every((x) => a.has(x))
const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && isSuperset(a, b)

function matchColorSet(cardSet: Set<string>, op: string, want: Set<string>, defaultOp: string): Tri {
  const o = op === ':' || op === '' ? defaultOp : op
  switch (o) {
    case '>=': return isSuperset(cardSet, want)
    case '<=': return isSuperset(want, cardSet)
    case '=': return setsEqual(cardSet, want)
    case '!=': return !setsEqual(cardSet, want)
    case '>': return isSuperset(cardSet, want) && !setsEqual(cardSet, want)
    case '<': return isSuperset(want, cardSet) && !setsEqual(cardSet, want)
    default: return isSuperset(cardSet, want)
  }
}

function compareNum(cardVal: number, op: string, want: number): boolean {
  switch (op) {
    case '<': return cardVal < want
    case '<=': return cardVal <= want
    case '>': return cardVal > want
    case '>=': return cardVal >= want
    case '!=': return cardVal !== want
    default: return cardVal === want
  }
}

/** `pow>tou` and friends compare two of the card's own numeric fields. */
const SELF_FIELDS: Record<string, 'power' | 'toughness' | 'loyalty' | 'defense'> = {
  pow: 'power', power: 'power',
  tou: 'toughness', toughness: 'toughness',
  loy: 'loyalty', loyalty: 'loyalty',
  def: 'defense', defense: 'defense',
}

// ---------------------------------------------------------------------------
// Mana symbols
// ---------------------------------------------------------------------------

/** Multiset of mana symbols in a cost string, e.g. `{2}{G}{G}` → 2 generic + 2 G. */
function symbolCounts(cost: string): Map<string, number> {
  const out = new Map<string, number>()
  const bump = (sym: string, by = 1) => out.set(sym, (out.get(sym) ?? 0) + by)
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1].toLowerCase()
    if (/^\d+$/.test(sym)) bump('generic', parseInt(sym, 10))
    else bump(sym)
  }
  return out
}

/** Parse a user-written cost like `2WW`, `{G}{U}`, `{R/P}` into the same shape. */
function parseCostArgument(value: string): Map<string, number> {
  const out = new Map<string, number>()
  const bump = (sym: string, by = 1) => out.set(sym, (out.get(sym) ?? 0) + by)
  let rest = value.toLowerCase()
  const braced = [...rest.matchAll(/\{([^}]+)\}/g)]
  for (const m of braced) {
    const sym = m[1]
    if (/^\d+$/.test(sym)) bump('generic', parseInt(sym, 10))
    else bump(sym)
  }
  rest = rest.replace(/\{[^}]+\}/g, '')
  for (const m of rest.matchAll(/\d+|[wubrgcxyzsp]/g)) {
    const sym = m[0]
    if (/^\d+$/.test(sym)) bump('generic', parseInt(sym, 10))
    else bump(sym)
  }
  return out
}

function containsCost(have: Map<string, number>, want: Map<string, number>): boolean {
  for (const [sym, n] of want) if ((have.get(sym) ?? 0) < n) return false
  return true
}

function costsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false
  for (const [sym, n] of a) if ((b.get(sym) ?? 0) !== n) return false
  return true
}

function matchCost(have: Map<string, number>, op: string, want: Map<string, number>): boolean {
  switch (op) {
    case '=': return costsEqual(have, want)
    case '!=': return !costsEqual(have, want)
    case '>=': return containsCost(have, want)
    case '>': return containsCost(have, want) && !costsEqual(have, want)
    case '<=': return containsCost(want, have)
    case '<': return containsCost(want, have) && !costsEqual(have, want)
    default: return containsCost(have, want)
  }
}

/** Devotion contributed by a cost to the colours in `want`. */
function devotionOf(cost: string, want: Map<string, number>): number {
  const colors = new Set<string>()
  for (const sym of want.keys()) for (const ch of sym.split('/')) if ('wubrg'.includes(ch)) colors.add(ch)
  let n = 0
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const parts = m[1].toLowerCase().split('/')
    if (parts.some((p) => colors.has(p))) n++
  }
  return n
}

// ---------------------------------------------------------------------------
// Layouts, formats, misc lookups
// ---------------------------------------------------------------------------

const LAYOUT_IS: Record<string, (l: string) => boolean> = {
  split: (l) => l === 'split',
  flip: (l) => l === 'flip',
  transform: (l) => l === 'transform',
  tdfc: (l) => l === 'transform',
  meld: (l) => l === 'meld',
  leveler: (l) => l === 'leveler',
  mdfc: (l) => l === 'modal_dfc',
  dfc: (l) =>
    l === 'transform' || l === 'modal_dfc' || l === 'double_faced_token' || l === 'meld' ||
    l === 'reversible_card' || l === 'art_series',
  adventure: (l) => l === 'adventure',
  saga: (l) => l === 'saga',
  class: (l) => l === 'class',
  case: (l) => l === 'case',
  prototype: (l) => l === 'prototype',
  mutate: (l) => l === 'mutate',
  reversible: (l) => l === 'reversible_card',
  token: (l) => l === 'token' || l === 'double_faced_token',
  augment: (l) => l === 'augment',
  host: (l) => l === 'host',
}

const PERMANENT_TYPES = /\b(artifact|creature|enchantment|land|planeswalker|battle)\b/
const PARTY_TYPES = /\b(cleric|rogue|warrior|wizard)\b/
const OUTLAW_TYPES = /\b(assassin|mercenary|pirate|rogue|warlock)\b/
const FUNNY_SET_TYPES = new Set(['funny'])

/**
 * French vanilla: every line of rules text is one of the card's own keyword
 * abilities. Keywords carry costs and arguments ("Morph {2}{W}{B}{G}",
 * "Cumulative upkeep—…", "Protection from red"), so each clause only has to
 * *start* with a keyword once reminder text is stripped.
 */
function isFrenchVanilla(card: ScryCard): boolean {
  const text = oracleText(card)
  if (!text.trim()) return false
  const kws = (card.keywords ?? []).map((k) => k.toLowerCase())
  if (!kws.length) return false
  const clauses = text
    .replace(/\s*\([^)]*\)/g, '')
    .split('\n')
    .flatMap((l) => l.split(','))
    .map((l) => l.trim())
    .filter(Boolean)
  return clauses.every((clause) => kws.some((k) => clause.startsWith(k)))
}

/** Scryfall's `is:` values that this evaluator can answer from a card object. */
function evalIs(card: ScryCard, value: string): Tri {
  const v = value.toLowerCase()
  const type = typeLine(card)
  const text = oracleText(card)
  const layout = lower(card.layout || 'normal')

  if (v in LAYOUT_IS) return LAYOUT_IS[v](layout)

  switch (v) {
    // Spells / permanents / effects
    case 'permanent': return PERMANENT_TYPES.test(type)
    case 'spell': return !/\bland\b/.test(type) && !/\btoken\b/.test(type)
    case 'historic': return /\blegendary\b/.test(type) || /\bartifact\b/.test(type) || /\bsaga\b/.test(type)
    case 'party': return /\bcreature\b/.test(type) && PARTY_TYPES.test(type)
    case 'outlaw': return /\bcreature\b/.test(type) && OUTLAW_TYPES.test(type)
    case 'modal': return /\bchoose one\b|\bchoose two\b|\bchoose up to\b|•/.test(text)
    case 'vanilla': return /\bcreature\b/.test(type) && text.trim() === ''
    case 'frenchvanilla': return /\bcreature\b/.test(type) && isFrenchVanilla(card)
    case 'bear': return card.cmc === 2 && faceViews(card).some((f) => f.power === '2' && f.toughness === '2')
    case 'manland': return /\bland\b/.test(type) && /becomes? a .*creature|becomes an? .*\d\/\d/.test(text)
    case 'legendary': return /\blegendary\b/.test(type)
    case 'meldpart': return layout === 'meld' && !(card.all_parts ?? []).some((p) => p.component === 'meld_result' && p.name === card.name)
    case 'meldresult': return layout === 'meld' && (card.all_parts ?? []).some((p) => p.component === 'meld_result' && p.name === card.name)

    // Mana
    // Phyrexian and hybrid symbols count wherever they appear, including inside
    // activated-ability costs in the rules text, not just the mana cost.
    case 'hybrid': {
      const symbols = [...faceViews(card).map((f) => f.mana), text].join(' ')
      return /\{[^}]*\/[^}]*\}/.test(symbols) && !/^\s*$/.test(symbols)
        ? [...symbols.matchAll(/\{([^}]*\/[^}]*)\}/g)].some((m) => !/\/p$/.test(m[1]))
        : false
    }
    case 'phyrexian': return /\/p\}/.test([...faceViews(card).map((f) => f.mana), text].join(' '))

    // Colour
    case 'indicator': return faceViews(card).some((f) => f.indicator.length > 0)
    case 'colorshifted': return (card.frame_effects ?? []).includes('colorshifted')

    // Format / legality
    case 'commander': return canBeCommander(card)
    case 'gamechanger': return !!card.game_changer
    case 'reserved': return !!card.reserved
    case 'partner': return /\bpartner\b/.test(text) || /\bchoose a background\b/.test(text) || /friends forever/.test(text) || /doctor's companion/.test(text)
    case 'companion': return /\bcompanion —/.test(text)

    // Print / physical
    case 'reprint': return !!card.reprint
    case 'promo': return !!card.promo
    case 'digital': return !!card.digital
    case 'foil': return !!card.foil || (card.finishes ?? []).includes('foil')
    case 'nonfoil': return !!card.nonfoil || (card.finishes ?? []).includes('nonfoil')
    case 'etched': return (card.finishes ?? []).includes('etched')
    case 'glossy': return (card.finishes ?? []).includes('glossy')
    case 'full': case 'fullart': return !!card.full_art
    case 'textless': return !!card.textless
    case 'oversized': return !!card.oversized
    case 'spotlight': return !!card.story_spotlight
    case 'variation': return !!card.variation
    case 'hires': return !!card.highres_image
    case 'booster': return !!card.booster
    case 'funny':
      return (
        FUNNY_SET_TYPES.has(lower(card.set_type)) ||
        card.security_stamp === 'acorn' ||
        (card.promo_types ?? []).includes('playtest')
      )
    case 'universesbeyond': return lower(card.frame) === '2015' && (card.promo_types ?? []).includes('universesbeyond')
    case 'borderless': return lower(card.border_color) === 'borderless'
    case 'alchemy': return lower(card.set_type) === 'alchemy' || (card.promo_types ?? []).includes('alchemy')
    case 'rebalanced': return card.name.startsWith('A-')
    case 'scryfallpreview': return (card.promo_types ?? []).includes('scryfallpreview')
    case 'contentwarning': return !!card.content_warning

    default:
      // Promo sub-types (is:prerelease, is:buyabox, …) live in promo_types.
      if ((card.promo_types ?? []).some((t) => t.toLowerCase() === v)) return true
      return 'unknown'
  }
}

function canBeCommander(card: ScryCard): boolean {
  const type = typeLine(card)
  if (/\blegendary\b/.test(type) && /\bcreature\b/.test(type)) return true
  return /can be your commander/.test(oracleText(card))
}

function legalityIs(card: ScryCard, format: string): boolean {
  return lower(card.legalities?.[format]) === 'legal'
}

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'special', 'mythic', 'bonus']
const RARITY_ALIASES: Record<string, string> = {
  c: 'common', u: 'uncommon', r: 'rare', m: 'mythic', s: 'special', b: 'bonus',
}

// ---------------------------------------------------------------------------
// Term evaluation
// ---------------------------------------------------------------------------

function textMatch(haystack: string, tok: { value: string; regex: boolean; exact: boolean }): Tri {
  if (tok.regex) {
    try {
      // `m` so `^`/`$` anchor to a line of oracle text, as Scryfall's do.
      return new RegExp(tok.value.replace(/\\\//g, '/'), 'im').test(haystack)
    } catch {
      return 'unknown'
    }
  }
  return haystack.includes(tok.value.toLowerCase())
}

/**
 * `is:` values this evaluator answers from the card object. Anything else — the
 * curated land cycles (is:fetchland, is:dual…), is:masterpiece, is:new/is:old —
 * needs Scryfall, and is reported by unsupportedRuleKeys() so the caller can ask.
 */
export const LOCAL_IS_VALUES = new Set([
  ...Object.keys(LAYOUT_IS),
  'permanent', 'spell', 'historic', 'party', 'outlaw', 'modal', 'vanilla', 'frenchvanilla',
  'bear', 'manland', 'legendary', 'meldpart', 'meldresult', 'hybrid', 'phyrexian',
  'indicator', 'colorshifted', 'commander', 'gamechanger', 'reserved', 'partner', 'companion',
  'reprint', 'promo', 'digital', 'foil', 'nonfoil', 'etched', 'glossy', 'full', 'fullart',
  'textless', 'oversized', 'spotlight', 'variation', 'hires', 'booster', 'funny',
  'universesbeyond', 'borderless', 'alchemy', 'rebalanced', 'scryfallpreview', 'contentwarning',
])

/** Keywords that need data a single card object doesn't carry. */
export const NON_LOCAL_KEYS = new Set([
  'in', 'cube', 'new', 'prints', 'sets', 'paperprints', 'papersets', 'illustrations',
  'otag', 'oracletag', 'function', 'atag', 'arttag', 'art', 'b', 'block', 'g', 'group',
  'cheapest', 'artists', 'unique', 'order', 'direction', 'prefer', 'include', 'sort',
])

function evalTerm(card: ScryCard, tok: Extract<Node, { kind: 'term' }>): Tri {
  const { key, op, value, regex, exact } = tok
  const v = value.toLowerCase()
  const num = Number(value)

  if (NON_LOCAL_KEYS.has(key)) return 'unknown'

  switch (key) {
    // ---- bare word / name ----
    case '': case 'name': {
      const name = lower(card.name)
      if (exact) {
        // `!"lightning bolt"` matches a card whose *face* carries that name too.
        const all = [name, ...card.name.split(' // ').map((n) => lower(n.trim())),
          ...faces(card).map((f) => lower(f.name))]
        return all.includes(v)
      }
      return textMatch(name, tok)
    }

    // ---- types ----
    case 't': case 'type': return textMatch(typeLine(card), tok)

    // ---- text ----
    case 'o': case 'oracle': case 'text':
    case 'fo': case 'fulloracle': {
      const { text, needle, asRegex } = oracleForMatch(card, value)
      return textMatch(text, { value: needle, regex: regex || asRegex, exact })
    }
    case 'kw': case 'keyword':
      return (card.keywords ?? []).some((k) => k.toLowerCase() === v)
    case 'ft': case 'flavor': return textMatch(flavorText(card), tok)
    case 'a': case 'artist': return textMatch(artists(card), tok)
    case 'wm': case 'watermark': return textMatch(watermarks(card), tok)

    // ---- colours ----
    case 'c': case 'color': case 'colors': {
      const sets = faceViews(card).map((f) => f.colors)
      if (v === 'm' || v === 'multicolor' || v === 'multicolour') return sets.some((c) => c.size > 1)
      if (Number.isFinite(num) && value.trim() !== '')
        return sets.some((c) => compareNum(c.size, op === ':' ? '=' : op, num))
      const want = colorLetters(v)
      if (!want) return 'unknown'
      if (want.size === 0) return op === '!=' ? sets.every((c) => c.size > 0) : sets.some((c) => c.size === 0)
      return sets.some((c) => matchColorSet(c, op, want, '>=') === true)
    }
    case 'id': case 'identity': case 'ci': {
      const cols = new Set((card.color_identity ?? []).map((c) => c.toUpperCase()))
      if (Number.isFinite(num) && value.trim() !== '') return compareNum(cols.size, op === ':' ? '=' : op, num)
      const want = colorLetters(v)
      if (!want) return 'unknown'
      if (want.size === 0) return op === '!=' ? cols.size > 0 : cols.size === 0
      return matchColorSet(cols, op, want, '<=')
    }
    case 'has':
      if (v === 'indicator') return faceViews(card).some((f) => f.indicator.length > 0)
      if (v === 'watermark') return watermarks(card).trim() !== ''
      return 'unknown'

    // ---- mana ----
    case 'm': case 'mana': {
      const want = parseCostArgument(value)
      return faceViews(card).some((f) => matchCost(symbolCounts(f.mana), op, want))
    }
    case 'mv': case 'cmc': case 'manavalue': {
      if (v === 'even') return card.cmc % 2 === 0
      if (v === 'odd') return card.cmc % 2 === 1
      if (!Number.isFinite(num)) return 'unknown'
      return compareNum(card.cmc, op === ':' ? '=' : op, num)
    }
    case 'devotion': {
      const want = parseCostArgument(value)
      if (!want.size) return 'unknown'
      const total = [...want.values()].reduce((n, x) => n + x, 0)
      return faceViews(card).some((f) =>
        compareNum(devotionOf(f.mana, want), op === ':' ? '>=' : op, total)
      )
    }
    case 'produces': {
      const made = new Set((card.produced_mana ?? []).map((c) => c.toUpperCase()))
      const want = colorLetters(v)
      if (!want) return 'unknown'
      return matchColorSet(made, op, want, '>=')
    }

    // ---- numeric card stats ----
    case 'pow': case 'power': case 'tou': case 'toughness':
    case 'loy': case 'loyalty': case 'def': case 'defense': {
      const field = SELF_FIELDS[key]
      const other = SELF_FIELDS[v]
      const views = faceViews(card)
      // Scryfall reads `*` and other variable stats as 0, so `pow=*` is `pow=0`.
      const want = Number.isFinite(num) ? num : toNumber(value)
      if (!other && want === null) return 'unknown'
      const mine = views.map((f) => toNumber(f[field])).filter((n): n is number => n !== null)
      if (!mine.length) return false
      if (other) {
        // Scryfall compares the two stats across the whole card, so a two-faced
        // card matches when any face's power beats any face's toughness.
        const theirs = views.map((f) => toNumber(f[other])).filter((n): n is number => n !== null)
        return mine.some((a) => theirs.some((b) => compareNum(a, op === ':' ? '=' : op, b)))
      }
      return mine.some((a) => compareNum(a, op === ':' ? '=' : op, want as number))
    }
    case 'pt': case 'powtou': {
      if (!Number.isFinite(num)) return 'unknown'
      return faceViews(card).some((f) => {
        const p = toNumber(f.power)
        const t = toNumber(f.toughness)
        return p !== null && t !== null && compareNum(p + t, op === ':' ? '=' : op, num)
      })
    }

    // ---- rarity ----
    case 'r': case 'rarity': {
      const cardR = lower(card.rarity)
      const want = RARITY_ALIASES[v] ?? v
      if (!cardR) return 'unknown'
      if (op === ':' || op === '=' || op === '') return cardR === want
      if (op === '!=') return cardR !== want
      const ci = RARITY_ORDER.indexOf(cardR)
      const wi = RARITY_ORDER.indexOf(want)
      if (ci === -1 || wi === -1) return 'unknown'
      return compareNum(ci, op, wi)
    }

    // ---- sets / printing ----
    case 's': case 'e': case 'set': case 'edition': return lower(card.set) === v
    case 'st': return lower(card.set_type) === v
    case 'cn': case 'number': {
      const cn = card.collector_number ?? ''
      if (op === ':' || op === '=' || op === '') return lower(cn) === v
      const mine = parseFloat(cn)
      if (!Number.isFinite(mine) || !Number.isFinite(num)) return 'unknown'
      return compareNum(mine, op, num)
    }
    case 'border': return lower(card.border_color) === v
    case 'frame':
      if (lower(card.frame) === v) return true
      return (card.frame_effects ?? []).some((f) => f.toLowerCase() === v)
    case 'stamp': return lower(card.security_stamp) === v
    case 'game': return (card.games ?? []).some((g) => g.toLowerCase() === v)
    case 'lang': case 'language': {
      if (v === 'any') return true
      const l = lower(card.lang || 'en')
      const LANGS: Record<string, string> = {
        english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it',
        portuguese: 'pt', japanese: 'ja', korean: 'ko', russian: 'ru',
        chinese: 'zhs', simplified: 'zhs', traditional: 'zht', phyrexian: 'ph',
      }
      return l === (LANGS[v] ?? v)
    }
    case 'layout': return lower(card.layout || 'normal') === v

    // ---- legality ----
    case 'f': case 'format': return legalityIs(card, v)
    case 'banned': return lower(card.legalities?.[v]) === 'banned'
    case 'restricted': return lower(card.legalities?.[v]) === 'restricted'
    case 'legal': return legalityIs(card, v)

    // ---- rankings ----
    case 'edhrec': case 'edhrecrank': {
      if (card.edhrec_rank == null) return false
      if (!Number.isFinite(num)) return 'unknown'
      return compareNum(card.edhrec_rank, op === ':' ? '=' : op, num)
    }
    case 'penny': case 'pennyrank': {
      if (card.penny_rank == null) return false
      if (!Number.isFinite(num)) return 'unknown'
      return compareNum(card.penny_rank, op === ':' ? '=' : op, num)
    }

    // ---- prices ----
    case 'usd': case 'eur': case 'tix': {
      // Scryfall matches on any finish's price, so a card whose only expensive
      // printing is the foil still answers `usd>=50`.
      const p = card.prices ?? { usd: null }
      const raws =
        key === 'usd' ? [p.usd, p.usd_foil, p.usd_etched]
        : key === 'eur' ? [p.eur, p.eur_foil]
        : [p.tix]
      const prices = raws.map((r) => (r ? parseFloat(r) : NaN)).filter((n) => Number.isFinite(n))
      if (!prices.length) return false
      if (!Number.isFinite(num)) return 'unknown'
      return prices.some((price) => compareNum(price, op === ':' ? '=' : op, num))
    }

    // ---- year / date ----
    case 'year': {
      const rel = card.released_at
      if (!rel) return 'unknown'
      if (!Number.isFinite(num)) return 'unknown'
      return compareNum(Number(rel.slice(0, 4)), op === ':' ? '=' : op, num)
    }
    case 'date': {
      const rel = card.released_at
      if (!rel) return 'unknown'
      const want = v === 'now' || v === 'today' ? new Date().toISOString().slice(0, 10) : v
      if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(want)) return 'unknown'
      const pad = (d: string) => (d.length === 4 ? `${d}-01-01` : d.length === 7 ? `${d}-01` : d)
      const a = rel
      const b = pad(want)
      switch (op === ':' ? '=' : op) {
        case '<': return a < b
        case '<=': return a <= b
        case '>': return a > b
        case '>=': return a >= b
        case '!=': return a !== b
        default: return a === b
      }
    }

    // ---- is / not ----
    case 'is': return evalIs(card, v)

    default:
      return 'unknown'
  }
}

function evalNode(card: ScryCard, node: Node): Tri {
  switch (node.kind) {
    case 'term':
      return evalTerm(card, node)
    case 'not': {
      const r = evalNode(card, node.node)
      return r === 'unknown' ? 'unknown' : !r
    }
    case 'and': {
      let sawUnknown = false
      for (const n of node.nodes) {
        const r = evalNode(card, n)
        if (r === false) return false
        if (r === 'unknown') sawUnknown = true
      }
      return sawUnknown ? 'unknown' : true
    }
    case 'or': {
      let sawUnknown = false
      for (const n of node.nodes) {
        const r = evalNode(card, n)
        if (r === true) return true
        if (r === 'unknown') sawUnknown = true
      }
      return sawUnknown ? 'unknown' : false
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// The raw rule string is already valid Scryfall syntax, so appending it to a
// search query just needs whitespace collapsed. Returns '' when there are no rules.
export function rulesToQuery(rules: string | undefined): string {
  return (rules ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Evaluate a card against a rule string. `unknown` (a keyword this evaluator
 * can't answer locally) is treated as a pass, so a rule never wrongly drops a
 * card — resolveRuleWhitelist() is what enforces those against Scryfall.
 */
export function cardMatchesRules(card: ScryCard, rules: string | undefined): boolean {
  if (!rules || !rules.trim()) return true
  return evalNode(card, parse(rules)) !== false
}

/** Keys in the rule string this evaluator can't answer from a card object. */
export function unsupportedRuleKeys(rules: string | undefined): string[] {
  if (!rules || !rules.trim()) return []
  const found = new Set<string>()
  const walk = (node: Node) => {
    if (node.kind === 'term') {
      if (NON_LOCAL_KEYS.has(node.key)) found.add(node.key)
      // An `is:` value we can't model needs Scryfall just as much as `otag:` does.
      else if (node.key === 'is' && !LOCAL_IS_VALUES.has(node.value.toLowerCase())) {
        found.add(`is:${node.value.toLowerCase()}`)
      }
      return
    }
    if (node.kind === 'not') return walk(node.node)
    node.nodes.forEach(walk)
  }
  walk(parse(rules))
  return [...found]
}

/** True when the rules lean on data only Scryfall can resolve. */
export function rulesNeedScryfall(rules: string | undefined): boolean {
  return unsupportedRuleKeys(rules).length > 0
}

// ---------------------------------------------------------------------------
// Scryfall fallback
// ---------------------------------------------------------------------------

/**
 * Cards recommended by EDHREC are resolved by name and never pass through a
 * Scryfall query, so keywords this evaluator can't model locally (`otag:`,
 * `cube:`, `in:`, `new:`, land-cycle shortcuts…) would silently do nothing.
 *
 * This asks Scryfall for the complete set of cards matching the rules within the
 * deck's colour identity and returns their names, so those recommendations can
 * be filtered by Scryfall's own matching. Returns null when the result set is
 * too large to enumerate — the caller then keeps the local evaluation rather
 * than dropping cards it can't verify.
 */
export async function resolveRuleWhitelist(
  rules: string | undefined,
  scopeQuery: string,
  opts: { base: string; maxCards?: number } = { base: 'https://api.scryfall.com' }
): Promise<Set<string> | null> {
  const query = rulesToQuery(rules)
  if (!query || !rulesNeedScryfall(rules)) return null
  const maxCards = opts.maxCards ?? 2000
  const names = new Set<string>()
  let url = `${opts.base}/cards/search?q=${encodeURIComponent(`${scopeQuery} ${query}`.trim())}&unique=cards&order=edhrec`
  try {
    while (url) {
      const res = await fetch(url)
      // 404 means "no cards match", which is a real (empty) answer.
      if (res.status === 404) return names
      if (!res.ok) return null
      const data = (await res.json()) as {
        data?: { name: string }[]
        has_more?: boolean
        next_page?: string
        total_cards?: number
      }
      if ((data.total_cards ?? 0) > maxCards) return null
      for (const c of data.data ?? []) {
        names.add(c.name)
        names.add(c.name.split(' // ')[0])
      }
      url = data.has_more && data.next_page ? data.next_page.replace('https://api.scryfall.com', opts.base) : ''
    }
    return names
  } catch {
    return null
  }
}
