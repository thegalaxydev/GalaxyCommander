import type { ScryCard } from './types'

// User-authored "Card Rules" — Scryfall-style filter fragments (e.g. `t:Legendary`,
// `-t:Land`, `-c:B`, `mv<=3`) that constrain which cards may enter a generated deck.
//
// Two consumers:
//   1. rulesToQuery()   — appended to Scryfall search queries so pool fetches are
//                         filtered server-side with the full Scryfall grammar.
//   2. cardMatchesRules() — a local evaluator for cards that never touch a search
//                         query (EDHREC recommendations resolved by name). It covers
//                         the operators people actually reach for in rules; anything
//                         it doesn't understand is ignored locally (the query-side
//                         filter still enforces it on the fetched pool), so an unknown
//                         token never wrongly drops a card.

export interface RuleToken {
  negate: boolean
  key: string
  op: string
  value: string
}

const COMPARATORS = ['<=', '>=', '!=', '<', '>', '=', ':']

// Split on whitespace while keeping quoted values (`t:"legendary creature"`) intact.
function splitTokens(input: string): string[] {
  const out: string[] = []
  const re = /[^\s"]*"[^"]*"[^\s"]*|[^\s"]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) out.push(m[0])
  return out
}

export function parseRules(input: string): RuleToken[] {
  const tokens: RuleToken[] = []
  for (let raw of splitTokens(input.trim())) {
    if (!raw) continue
    let negate = false
    if (raw.startsWith('-')) {
      negate = true
      raw = raw.slice(1)
    }
    if (!raw) continue
    // Find `key<op>value`. Longest comparator wins so `<=` beats `<`.
    let key = ''
    let op = ''
    let value = raw
    let idx = -1
    for (const c of COMPARATORS) {
      const at = raw.indexOf(c)
      if (at > 0 && (idx === -1 || at < idx || (at === idx && c.length > op.length))) {
        idx = at
        op = c
        key = raw.slice(0, at)
        value = raw.slice(at + c.length)
      }
    }
    value = value.replace(/^"|"$/g, '')
    tokens.push({ negate, key: key.toLowerCase(), op, value: value.toLowerCase() })
  }
  return tokens
}

// The raw rule string is already valid Scryfall syntax, so appending it to a search
// query just needs whitespace collapsed. Returns '' when there are no rules.
export function rulesToQuery(rules: string | undefined): string {
  return (rules ?? '').replace(/\s+/g, ' ').trim()
}

function oracleOf(card: ScryCard): string {
  const parts = [card.oracle_text ?? '', ...(card.card_faces ?? []).map((f) => f.oracle_text ?? '')]
  return parts.join('\n').toLowerCase()
}

function cardColors(card: ScryCard): Set<string> {
  return new Set((card.colors ?? []).map((c) => c.toUpperCase()))
}

const COLOR_WORDS: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  colorless: '',
}

// Turn `rg`, `red`, `wubrg`, `c` into a set of color letters.
function colorLetters(value: string): Set<string> {
  if (value in COLOR_WORDS) {
    const l = COLOR_WORDS[value]
    return new Set(l ? [l] : [])
  }
  const set = new Set<string>()
  for (const ch of value.toUpperCase()) {
    if ('WUBRG'.includes(ch)) set.add(ch)
    // 'C' / other letters denote colorless — an empty set.
  }
  return set
}

function isSuperset(a: Set<string>, b: Set<string>): boolean {
  for (const x of b) if (!a.has(x)) return false
  return true
}
function isSubset(a: Set<string>, b: Set<string>): boolean {
  return isSuperset(b, a)
}
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && isSuperset(a, b)
}

function matchColors(cardSet: Set<string>, op: string, want: Set<string>): boolean {
  switch (op) {
    case '>=':
      return isSuperset(cardSet, want)
    case '<=':
      return isSubset(cardSet, want)
    case '=':
      return setsEqual(cardSet, want)
    case '>':
      return isSuperset(cardSet, want) && !setsEqual(cardSet, want)
    case '<':
      return isSubset(cardSet, want) && !setsEqual(cardSet, want)
    // Bare `c:rg` means "contains all of these colors" (Scryfall default).
    default:
      return isSuperset(cardSet, want)
  }
}

function compareNum(cardVal: number, op: string, want: number): boolean {
  switch (op) {
    case '<':
      return cardVal < want
    case '<=':
      return cardVal <= want
    case '>':
      return cardVal > want
    case '>=':
      return cardVal >= want
    case '!=':
      return cardVal !== want
    default:
      return cardVal === want
  }
}

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus']

const PERMANENT_TYPES = /\b(artifact|creature|enchantment|land|planeswalker|battle)\b/

// Evaluate a single token. Returns 'skip' for operators we don't model locally so the
// token neither includes nor excludes (the Scryfall query still enforces it on pools).
function matchToken(card: ScryCard, tok: RuleToken): boolean | 'skip' {
  const { key, op, value } = tok
  switch (key) {
    case '':
      // Bare word → Scryfall matches card name.
      return card.name.toLowerCase().includes(value)
    case 't':
    case 'type':
      return card.type_line.toLowerCase().includes(value)
    case 'o':
    case 'oracle':
    case 'text':
      return oracleOf(card).includes(value)
    case 'name':
      return card.name.toLowerCase().includes(value)
    case 'c':
    case 'color':
    case 'colors':
      return matchColors(cardColors(card), op, colorLetters(value))
    case 'id':
    case 'identity':
    case 'ci': {
      const cardId = new Set(card.color_identity.map((c) => c.toUpperCase()))
      // `id:` defaults to "within" (subset) — Scryfall's commander-deckbuilding sense.
      return matchColors(cardId, op === ':' || op === '' ? '<=' : op, colorLetters(value))
    }
    case 'mv':
    case 'cmc':
    case 'mc':
    case 'manavalue': {
      const want = Number(value)
      if (!Number.isFinite(want)) return 'skip'
      return compareNum(card.cmc, op, want)
    }
    case 'r':
    case 'rarity': {
      const cardR = (card.rarity ?? '').toLowerCase()
      if (op === ':' || op === '=' || op === '') return cardR === value
      const ci = RARITY_ORDER.indexOf(cardR)
      const wi = RARITY_ORDER.indexOf(value)
      if (ci === -1 || wi === -1) return 'skip'
      return compareNum(ci, op, wi)
    }
    case 'kw':
    case 'keyword':
      return (card.keywords ?? []).some((k) => k.toLowerCase() === value)
    case 'is':
      switch (value) {
        case 'permanent':
          return PERMANENT_TYPES.test(card.type_line.toLowerCase())
        case 'spell':
          return !/\bland\b/.test(card.type_line.toLowerCase())
        case 'legendary':
          return /\blegendary\b/.test(card.type_line.toLowerCase())
        case 'vanilla':
          return /\bcreature\b/.test(card.type_line.toLowerCase()) && oracleOf(card).trim() === ''
        case 'gamechanger':
          return !!card.game_changer
        default:
          return 'skip'
      }
    default:
      return 'skip'
  }
}

// AND semantics across tokens (matching Scryfall). Unmodeled tokens are ignored.
export function cardMatchesRules(card: ScryCard, rules: string | undefined): boolean {
  if (!rules || !rules.trim()) return true
  for (const tok of parseRules(rules)) {
    const res = matchToken(card, tok)
    if (res === 'skip') continue
    if ((tok.negate ? !res : res) === false) return false
  }
  return true
}
