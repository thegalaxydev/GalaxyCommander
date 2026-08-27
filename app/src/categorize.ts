// Card categorization: assigns every card a primary deckbuilding role, fully
// offline and synchronous. categorize() answers "why is this card in the deck",
// so detectors look for what a card *does for the deck*, not what it is — a
// 2/2 that tutors is a Tutor, a 9/9 that happens to draw is a Finisher.
//
// Detector order is the tie-breaker for cards that do several things: the
// earlier role is the one the card is played for. cardRoles() returns every
// matching role for callers (deck health, analysis) that care about all of a
// card's jobs rather than the single best label.
import type { Category, ScryCard } from './types'
import { cardOracle } from './scryfall'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Front-face type line — MDFC backs shouldn't drive the primary role. */
function frontType(card: ScryCard): string {
  return (card.type_line ?? '').split('//')[0]
}

function frontPower(card: ScryCard): number {
  const pow = card.power ?? card.card_faces?.[0]?.power ?? '0'
  return parseInt(pow, 10) || 0
}

/** Split oracle text into sentences so a match can be judged in context. */
function sentences(text: string): string[] {
  return text.split(/(?<=\.)\s+|\n/).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Ramp
// ---------------------------------------------------------------------------

// "Search your library for a Plains, Island, Swamp, or Mountain card" (Farseek)
// and "a Forest card" (Nature's Lore) are ramp too — matching only the literal
// word "land" is the bug that filed half of green's ramp package under Synergy.
const LAND_WORDS = String.raw`(?:land|plains|island|swamp|mountain|forest|wastes|gate)`

const RAMP_PATTERNS: RegExp[] = [
  // Repeatable mana production: dorks, rocks, "{T}, Sacrifice: Add", outlets.
  /\{T\}[^:]*: Add/i,
  // Ritual-style and triggered mana: "Add {B}{B}{B}", "add one mana of any
  // color", doublers' "add one additional mana".
  /\badd \{[WUBRGC0-9]/i,
  /\badds? (?:one|two|three|four|\d+|X) (?:additional )?mana/i,
  /\badds? that (?:much|many) mana/i,
  // Land search that reaches the battlefield or hand — your library only, so
  // Path to Exile's consolation basic stays Removal.
  new RegExp(String.raw`search your library for [^.]*?${LAND_WORDS}[^.]*? cards?`, 'i'),
  // Extra land drops (Exploration, Azusa) and hand-to-battlefield lands.
  /play (?:an additional land|two additional lands|any number of (?:additional )?lands)/i,
  /put (?:a|up to \w+|that many|X|\d+) land cards? from your hand onto the battlefield/i,
  // Treasure is mana in escrow (Smothering Tithe, Dockside Extortionist).
  /create[^.]*?\bTreasure\b/,
  // Cost reducers accelerate the same way ramp does. The plural "spells ...
  // cost" avoids self-discounts ("This spell costs {1} less to cast if ...").
  /\bspells (?:you cast )?[^.]*?cost \{\d+\} less to cast/i,
]

function isRamp(_card: ScryCard, text: string): boolean {
  return RAMP_PATTERNS.some((re) => re.test(text))
}

// ---------------------------------------------------------------------------
// Board wipes
// ---------------------------------------------------------------------------

// A board wipe has to actually *remove* a board. Matching bare "each creature"
// swept up every anthem and counter-doubler (Bristly Bill, Spine Sower reads
// "Double the number of +1/+1 counters on each creature you control"), so each
// alternative below pairs a mass quantifier with a destructive verb.
//
// Two kinds of near-miss are filtered out rather than matched:
//  - combat-scoped effects ("destroy all creatures blocking it"), which read
//    like a wipe but only ever hit the creatures in one combat;
//  - self-sacrifice combos ("sacrifice all creatures you control, then create
//    that many tokens"), which are engine pieces, not removal.
const COMBAT_SCOPED = /\b(?:blocking|blocked by|becomes blocked)\b/i
const SELF_SACRIFICE = /\b(?:sacrifice|exile)\s+(?:all|each)\s+creatures?\s+you\s+control\b/i
// "Exile each opponent's graveyard" reads like a wipe but empties graveyards,
// not boards — those sentences belong to Graveyard Hate. A real wipe with a
// graveyard mode (Farewell) still matches on its other sentences.
const GRAVEYARD_SCOPED = /\bgraveyards?\b/i
const STACK_SCOPED = /\bspells\b/i

// Amounts are written as digits or as X, and the mass noun often carries a
// qualifier ("each non-Dragon creature", "each creature with flying").
const N = String.raw`(?:\d+|X)`
const EACH_CREATURE = String.raw`each\s+(?:\w+[- ]){0,3}creature`
const MINUS = '[-−]'

// The generic destroy/exile-all pattern is the only one loose enough to need
// the graveyard and stack guards: "Exile each opponent's graveyard" empties
// graveyards (Graveyard Hate) and "Exile all other spells" clears the stack
// (Counterspells). The specific patterns (mass sacrifice, -X/-X, mass damage)
// stay wipes even when their sentence mentions a graveyard — Living Death's
// single long sentence both reanimates and sacrifices.
const GENERIC_WIPE = /\b(?:destroy|exile)\s+(?:all|each)\b/i

const BOARD_WIPE_PATTERNS: RegExp[] = [
  // Destroy/exile all or each creature — the classic wrath.
  GENERIC_WIPE,
  // Mass bounce and mass tuck count too (Aetherize, Evacuation, Cyclonic Rift's
  // overload line "Return each nonland permanent you don't control").
  /\breturn\s+(?:all|each)\s+[^.]*(?:creatures?|permanents)\b/i,
  // -X/-Y sweepers, but only when toughness actually drops; "-1/-0" is a
  // combat trick (Bone Flute), not a wipe.
  new RegExp(String.raw`\b(?:all|each)\s+(?:other\s+)?creatures?\s+gets?\s+${MINUS}${N}\/${MINUS}(?:[1-9]|X)`, 'i'),
  new RegExp(
    String.raw`\bcreatures?\s+(?:your opponents?|target player|each player|they)[^.]*?gets?\s+${MINUS}${N}\/${MINUS}(?:[1-9]|X)`,
    'i'
  ),
  // -1/-1 counters spread across the board (Black Sun's Zenith).
  new RegExp(String.raw`${MINUS}1\/${MINUS}1\s+counters?\s+on\s+${EACH_CREATURE}`, 'i'),
  // Mass damage. The amount is often split across a sentence that hits a player
  // first ("deals X damage to target player and each creature that player
  // controls"), so the damage clause and the mass noun are matched separately.
  new RegExp(String.raw`\b${N}\s+damage\s+to\s+[^.]*?${EACH_CREATURE}`, 'i'),
  new RegExp(String.raw`deals?\s+damage\s+equal[^.]*?to\s+[^.]*?${EACH_CREATURE}`, 'i'),
  // Mass sacrifice, including the "keep N, sacrifice the rest" template.
  /\beach\s+player\s+sacrifices\b/i,
  /\bsacrifices?\s+all\b/i,
  /\bsacrifices?\s+the\s+rest\b/i,
]

export function isBoardWipe(text: string): boolean {
  return BOARD_WIPE_PATTERNS.some((re) => {
    const match = text.match(re)
    if (!match) return false
    // Judge the sentence the match landed in, not the whole card.
    const start = text.lastIndexOf('.', match.index ?? 0) + 1
    const end = text.indexOf('.', (match.index ?? 0) + match[0].length)
    const sentence = text.slice(start, end === -1 ? undefined : end)
    if (COMBAT_SCOPED.test(sentence) || SELF_SACRIFICE.test(sentence)) return false
    if (re === GENERIC_WIPE && (GRAVEYARD_SCOPED.test(sentence) || STACK_SCOPED.test(sentence)))
      return false
    return true
  })
}

function isWipe(card: ScryCard, text: string): boolean {
  return isBoardWipe(text) || (/\boverload\b/i.test(text) && isRemoval(card, text))
}

// ---------------------------------------------------------------------------
// Counterspells
// ---------------------------------------------------------------------------

const COUNTERSPELL = /\bcounter (?:target|that|all|each|the next|it\b)[^.]*?(?:spell|abilit|\bit\b)/i

function isCounterspell(_card: ScryCard, text: string): boolean {
  return COUNTERSPELL.test(text)
}

// ---------------------------------------------------------------------------
// Graveyard hate
// ---------------------------------------------------------------------------

const GRAVE_HATE_PATTERNS: RegExp[] = [
  // Tormod's Crypt, Bojuka Bog templating: exile a whole graveyard.
  /exile (?:all (?:cards|creature cards|the cards) (?:from|in) )?(?:all|each|every|target player's|each player's|each opponent's|that player's|a single) graveyards?/i,
  /exile target player's graveyard/i,
  // Replacement hate (Rest in Peace, Leyline of the Void).
  /would (?:be put into|die|enter) (?:a|an opponent's|your opponents'|the) graveyards?[^.]*?exile (?:it|that card|them|those cards) instead/i,
  /put into (?:a|an opponent's|your opponents'|the) graveyards? from anywhere[^.]*?exile/i,
  // Static lockouts (Grafdigger's Cage, Dauthi Voidwalker's "instead" rider).
  /cards? in graveyards?(?: and libraries)? can't/i,
  /players? can't cast spells from (?:their )?graveyards?/i,
  // Spot hate: exiling single cards out of anyone else's graveyard.
  /exile (?:up to \w+ )?target cards? from (?:a|target|each|every|an opponent's) graveyard/i,
]

function isGraveHate(_card: ScryCard, text: string): boolean {
  return GRAVE_HATE_PATTERNS.some((re) => re.test(text))
}

// ---------------------------------------------------------------------------
// Finishers
// ---------------------------------------------------------------------------

const FINISHER_PATTERNS: RegExp[] = [
  /\bwins? the game\b/i,
  /\bloses? the game\b/i,
  /take (?:an|two) extra turns?/i,
  /(?:additional|extra) combat phase/i,
  /double strike[^.]*trample|combat damage to a player, /i,
]

// One-shot overrun pumps (Overwhelming Stampede, Craterhoof's trigger). The
// pump must be at least +2 or +X — +1/+1 is an anthem — and must expire, so
// static anthems of any size stay Synergy.
const OVERRUN_PUMP = new RegExp(String.raw`creatures you control [^.]*?\+(?:[2-9]|X)\/\+(?:[0-9]|X)`, 'i')

function isFinisher(card: ScryCard, text: string): boolean {
  if (frontPower(card) >= 6) return true
  if (FINISHER_PATTERNS.some((re) => re.test(text))) return true
  return sentences(text).some((s) => OVERRUN_PUMP.test(s) && /until end of turn/i.test(s))
}

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

// "Exile target creature you control" is blink/value, not removal — every
// targeted-removal sentence has to point at something of the opponent's.
const SELF_TARGETED = /target [^.]*?you control/i

const REMOVAL_SENTENCE_PATTERNS: RegExp[] = [
  /\b(?:destroy|exile)\s+(?:up to \w+ )?(?:another )?target\b/i,
  new RegExp(String.raw`deals? (?:${N}|that much) damage to (?:any target|target|each of up to)`, 'i'),
  new RegExp(String.raw`deals? ${N} damage divided (?:as you choose )?among`, 'i'),
  /deals? damage equal [^.]*? to (?:any target|target)/i,
  /\bfights?\s+(?:up to \w+ )?(?:another )?target\b/i,
  new RegExp(String.raw`target creature gets ${MINUS}${N}\/${MINUS}(?:[1-9]|X)`, 'i'),
  // Edicts, one-shot and repeatable (Grave Pact).
  /(?:target|each) (?:other )?(?:player|opponent) sacrifices? (?:a|an|one|two|X|that many)? ?(?:creature|permanent|artifact|enchantment|planeswalker|nonland)/i,
  // Pacifism-style neutralizers.
  /enchanted (?:creature|permanent) can't attack(?: or block)?/i,
  // Bounce and tuck aimed at the opponent's board.
  /(?:return|put)s? (?:up to \w+ |\w+ )?(?:another )?target [^.]*?(?:to (?:its|their) owner'?s'? hands?|on (?:the )?(?:top|bottom) of (?:its|their) owner'?s'? librar)/i,
  /owner of target [^.]*? shuffles it into (?:their|its owner's) library/i,
]

function isRemoval(_card: ScryCard, text: string): boolean {
  return sentences(text).some(
    (s) => REMOVAL_SENTENCE_PATTERNS.some((re) => re.test(s)) && !SELF_TARGETED.test(s)
  )
}

// ---------------------------------------------------------------------------
// Tutors
// ---------------------------------------------------------------------------

export function isTutor(card: ScryCard): boolean {
  const text = cardOracle(card)
  return (
    /search your library for (?:a|an|up to|any number|one|two|three|four)\b/i.test(text) &&
    !new RegExp(String.raw`search your library for [^.]*?${LAND_WORDS}[^.]*? cards?`, 'i').test(text)
  )
}

// ---------------------------------------------------------------------------
// Card draw
// ---------------------------------------------------------------------------

const DRAW_PATTERNS: RegExp[] = [
  /draws? (?:a card|(?:two|three|four|five|six|seven|\d+|X) (?:additional )?cards|that many cards|cards equal)/i,
  // Impulse draw: exile from the top, play it later.
  /exile the top (?:card|(?:two|three|four|five|\d+|X) cards) of your library[^.]*?(?:may )?(?:play|cast)/i,
  /exile the top card of your library[\s\S]{0,80}?put (?:it|that card) into your hand/i,
  // Dig effects that put cards in hand (Impulse, Dig Through Time).
  /look at the top [^.]*? of your library[^.]*?into your hand/i,
]

function isCardDraw(_card: ScryCard, text: string): boolean {
  return DRAW_PATTERNS.some((re) => re.test(text))
}

// ---------------------------------------------------------------------------
// Recursion
// ---------------------------------------------------------------------------

const RECURSION_PATTERNS: RegExp[] = [
  /return[^.]*? from your graveyard to (?:your hand|the battlefield)/i,
  /put[^.]*? from your graveyard onto the battlefield/i,
  /cast[^.]*? from your graveyard/i,
  // Reanimation that reaches into any graveyard (Animate Dead, Reanimate).
  /enchant creature card in a graveyard/i,
  /(?:return|put) [^.]*? card from (?:a|target|each|any) graveyard (?:to your hand|onto the battlefield)/i,
]

function isRecursion(_card: ScryCard, text: string): boolean {
  return RECURSION_PATTERNS.some((re) => re.test(text))
}

// ---------------------------------------------------------------------------
// Protection
// ---------------------------------------------------------------------------

// The keyword has to be *granted* — a creature that merely has hexproof is not
// a protection spell, so every pattern needs a verb or a "you" subject.
const PROTECTION_PATTERNS: RegExp[] = [
  /(?:gains?|gets?|has|have) (?:[^.]*? and )?(?:hexproof|shroud|indestructible|protection from)/i,
  /you (?:gain|have) (?:hexproof|shroud|protection)/i,
  /prevent all (?:combat )?damage/i,
  /phases? out/i,
  /counter target spell that targets/i,
  /can't be targeted by spells or abilities your opponents control/i,
]

function isProtection(_card: ScryCard, text: string): boolean {
  return PROTECTION_PATTERNS.some((re) => re.test(text))
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const TOKEN_PATTERNS: RegExp[] = [
  /creates? [^.]*?creature tokens?/i,
  /would create one or more tokens[^.]*?instead/i,
  /\bpopulate\b/i,
]

function isTokens(_card: ScryCard, text: string): boolean {
  return TOKEN_PATTERNS.some((re) => re.test(text))
}

// ---------------------------------------------------------------------------
// Stax
// ---------------------------------------------------------------------------

const STAX_PATTERNS: RegExp[] = [
  /(?:spells|abilities)[^.]*?cost \{?\d+\}? more to (?:cast|activate)/i,
  /can't cast (?:spells|more than one spell)/i,
  /(?:opponents|players)\b[^.]*? can't\b/i,
  // Untap denial needs a plural subject so "It doesn't untap during your untap
  // step" (a self drawback, e.g. Colossus of Sardia) doesn't count.
  /(?:lands?|permanents?|creatures?|artifacts?|nonland permanents)[^.]*? don't untap during/i,
  /skips? (?:their|that player's|each player's) (?:untap|draw|combat) (?:step|phase)/i,
  /unless (?:that player|they|its controller) pays?/i,
]

function isStax(_card: ScryCard, text: string): boolean {
  return STAX_PATTERNS.some((re) => re.test(text))
}

// ---------------------------------------------------------------------------
// categorize
// ---------------------------------------------------------------------------

type Detector = (card: ScryCard, text: string) => boolean

// Order is the priority for the primary role: the earlier entry is what the
// card is played *for*. Notably Finishers sits ahead of Removal and Card Draw
// so a 10/10 with an exile rider or a draw trigger reads as the threat it is,
// while small utility bodies keep their utility label.
const DETECTORS: [Category, Detector][] = [
  ['Board Wipes', isWipe],
  ['Counterspells', isCounterspell],
  ['Ramp', isRamp],
  ['Graveyard Hate', isGraveHate],
  ['Finishers', isFinisher],
  ['Removal', isRemoval],
  ['Tutors', (c) => isTutor(c)],
  ['Card Draw', isCardDraw],
  ['Recursion', isRecursion],
  ['Protection', isProtection],
  ['Tokens', isTokens],
  ['Stax', isStax],
]

export function categorize(card: ScryCard): Category {
  if (/\bLand\b/.test(frontType(card))) return 'Lands'
  const text = cardOracle(card)
  for (const [cat, matches] of DETECTORS) {
    if (matches(card, text)) return cat
  }
  return 'Synergy'
}

/**
 * Every functional role the card fills, not just the primary one — deck health
 * wants to know that a Removal card also protects, or that a commander's
 * Finisher also draws.
 */
export function cardRoles(card: ScryCard): Category[] {
  if (/\bLand\b/.test(frontType(card))) return ['Lands']
  const text = cardOracle(card)
  const roles = DETECTORS.filter(([, matches]) => matches(card, text)).map(([cat]) => cat)
  return roles.length ? roles : ['Synergy']
}
