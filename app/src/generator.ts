import type {
  BudgetCaps,
  BudgetTier,
  BuildSettings,
  Category,
  Deck,
  DeckCard,
  PowerProfile,
  ScryCard,
  UpgradeTier,
  UpgradeSwap,
} from './types'
import { DEFAULT_BUDGET_CAPS, DEFAULT_PROFILE } from './types'
import { searchCards, cardOracle, cardPrice, cardManaCost, legalOrUpcoming } from './scryfall'
import { commanderSlug, fetchEdhrecPageBySlug, resolveCards, type EdhrecRec, type EdhrecPage } from './edhrec'
import { themeQuery, TAG_QUERIES, detectTribe } from './themes'
import { unionIdentity } from './partner'
import { finalScore, rankInclusion, resolveWeights } from './scoring'
import { estimateBracketFromCards, isMassLandDenial, comboMinBracket } from './analysis'
import { findCombos } from './combos'
import { rulesToQuery, cardMatchesRules } from './deckRules'

export type ProgressFn = (stepIndex: number, cards: DeckCard[]) => void

export const GEN_STEPS = [
  'Consulting EDHREC...',
  'Building Mana Base...',
  'Finding Synergies...',
  'Balancing Curve...',
  'Checking Legality...',
]

function budgetCap(tier: BudgetTier, caps?: BudgetCaps): number {
  if (tier === 'any') return Infinity
  const resolved = caps ?? DEFAULT_BUDGET_CAPS
  const value = resolved[tier]
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BUDGET_CAPS[tier]
}

interface Candidate {
  card: ScryCard
  score: number
  reason: string
}

function identityQuery(identity: string[], excludeNames: string[]): string {
  const id = identity.length ? identity.join('').toLowerCase() : 'c'
  const excludes = excludeNames
    .map((n) => `-name:"${n.split('//')[0].trim()}"`)
    .join(' ')
  return `${legalOrUpcoming()} id<=${id} ${excludes}`
}

function isLegal(card: ScryCard, noSpoilers = false): boolean {
  if (card.legalities?.commander === 'legal') return true
  if (noSpoilers) return false
  return !!card.released_at && new Date(card.released_at) > new Date()
}

function fitsIdentity(card: ScryCard, identity: string[]): boolean {
  const id = new Set(identity)
  return card.color_identity.every((c) => id.has(c))
}

const BASIC_TYPE_COLOR: Record<string, string> = {
  Plains: 'W',
  Island: 'U',
  Swamp: 'B',
  Mountain: 'R',
  Forest: 'G',
}

function offColorFetchLand(card: ScryCard, identity: string[]): boolean {
  const type = (card.type_line ?? '').split('//')[0]
  if (!/\bLand\b/.test(type)) return false
  const text = cardOracle(card)
  if (!/search your library for/i.test(text)) return false
  const named = Object.keys(BASIC_TYPE_COLOR).filter((t) =>
    new RegExp(`\\b${t}\\b`).test(text)
  )
  if (named.length === 0) return false
  const id = new Set(identity)
  return !named.some((t) => id.has(BASIC_TYPE_COLOR[t]))
}

// The ten original dual lands (ABUR duals): untapped, two basic land types,
// no drawback, and fetchable — but they have low EDHREC inclusion because of
// their price, so they must be pulled in explicitly at unconstrained budget.
const ORIGINAL_DUAL_LANDS: { name: string; colors: [string, string] }[] = [
  { name: 'Tundra', colors: ['W', 'U'] },
  { name: 'Underground Sea', colors: ['U', 'B'] },
  { name: 'Badlands', colors: ['B', 'R'] },
  { name: 'Taiga', colors: ['R', 'G'] },
  { name: 'Savannah', colors: ['G', 'W'] },
  { name: 'Scrubland', colors: ['W', 'B'] },
  { name: 'Volcanic Island', colors: ['U', 'R'] },
  { name: 'Bayou', colors: ['B', 'G'] },
  { name: 'Plateau', colors: ['R', 'W'] },
  { name: 'Tropical Island', colors: ['G', 'U'] },
]

// Rewards good fixing lands (multicolor producers + true fetches) so they win
// utility-land slots over ubiquitous-but-mediocre fixing (Command Tower aside).
// At unconstrained budget, price is used as a positive quality signal because
// premium fixing (fetches, shocks, original duals) is exactly what costs more.
function landFixingScore(card: ScryCard, identity: string[], cap: number): number {
  const type = (card.type_line ?? '').split('//')[0]
  if (!/\bLand\b/.test(type) || /\bBasic\b/.test(type)) return 0
  const text = cardOracle(card)
  const idSet = new Set(identity)
  const colorsProduced = new Set((card.produced_mana ?? []).filter((c) => idSet.has(c))).size
  const isFetch =
    /search your library for/i.test(text) &&
    /(plains|island|swamp|mountain|forest|\bland card\b)/i.test(text)
  let bonus = 0
  if (colorsProduced >= 2) bonus += 1.0 + (colorsProduced - 2) * 0.5
  if (isFetch) bonus += 1.5
  // At "Any" budget, premium fixing is overlooked purely because it costs more;
  // turn price into a quality signal (capped) for fixing lands only.
  if (!Number.isFinite(cap) && (isFetch || colorsProduced >= 2)) {
    bonus += Math.min(2, Math.log10(cardPrice(card) + 1))
  }
  return bonus
}

function usesAttractions(card: ScryCard): boolean {
  return /\battraction/i.test(cardOracle(card))
}

async function buildAttractions(): Promise<DeckCard[]> {
  const cards = await searchCards('t:attraction', { order: 'edhrec', max: 10 })
  const seen = new Set<string>()
  const out: DeckCard[] = []
  for (const card of cards) {
    if (seen.has(card.name)) continue
    seen.add(card.name)
    out.push({ card, category: 'Synergy', qty: 1, reason: 'Part of your Attraction deck (sideboard).' })
    if (out.length >= 10) break
  }
  return out
}

function isLandsMatter(settings: BuildSettings): boolean {
  if (settings.themes.some((t) => /\bland(fall|s)?\b/i.test(t))) return true
  const text = `${cardOracle(settings.commander)} ${
    settings.partner ? cardOracle(settings.partner) : ''
  }`
  return /landfall|whenever a land(?: card)? you control enters|play an additional land|for each land/i.test(
    text
  )
}

function isManaRock(card: ScryCard): boolean {
  const type = (card.type_line ?? '').split('//')[0]
  if (!/\bArtifact\b/.test(type) || /\bCreature\b/.test(type)) return false
  return /\{T\}: Add/i.test(cardOracle(card))
}

function isLandRamp(card: ScryCard): boolean {
  const text = cardOracle(card)
  return (
    /search your library for[^.]*\bland/i.test(text) &&
    /onto the battlefield|into play/i.test(text)
  )
}

interface CardWithPower extends ScryCard {
  power?: string
}

export function categorize(card: ScryCard): Category {
  const type = card.type_line ?? ''
  const text = cardOracle(card)
  if (/\bLand\b/.test(type.split('//')[0])) return 'Lands'
  if (
    card.cmc <= 4 &&
    (/{T}: Add|adds? (one|two|three) mana|{T}, Sacrifice .*: Add/i.test(text) ||
      /search your library for (a|up to two|up to three) (basic )?lands?/i.test(text))
  )
    return 'Ramp'
  if (/draw (a card|two cards|three cards|x cards|that many cards|cards equal)/i.test(text) && card.cmc <= 5)
    return 'Card Draw'
  if (/destroy all|exile all|all creatures get -|each creature|sacrifices? all/i.test(text))
    return 'Board Wipes'
  if (
    /destroy target|exile target|counter target|deals? \d+ damage to any target|deals? damage equal .* to target|fight target/i.test(
      text
    )
  )
    return 'Removal'
  const pow = parseInt((card as CardWithPower).power ?? '0', 10)
  if (
    pow >= 6 ||
    /wins? the game|loses? the game|take an extra turn|double strike.*trample|combat damage to a player, /i.test(text)
  )
    return 'Finishers'
  return 'Synergy'
}

function isTutor(card: ScryCard): boolean {
  const text = cardOracle(card)
  return (
    /search your library for a/i.test(text) &&
    !/search your library for (a|up to \w+) (basic )?lands?/i.test(text)
  )
}

const COMBO_HINTS = /untap (all|target|each)|copy target|infinite|whenever .* untaps|opponents? can't|extra combat/i
function isComboPiece(card: ScryCard): boolean {
  return COMBO_HINTS.test(cardOracle(card))
}

const COMMANDER_IDENTITY_MANA =
  /any color in your commander'?s color identity|any color among your commanders'? color identities/i

function deadInColorless(card: ScryCard): boolean {
  return COMMANDER_IDENTITY_MANA.test(cardOracle(card))
}

interface Targets {
  lands: number
  ramp: number
  draw: number
  removal: number
  wipes: number
  finishers: number
}

function profileScale(value: number): number {
  return 0.6 + (value / 100) * 0.8
}

function buildTargets(settings: BuildSettings, profile: PowerProfile): Targets {
  const t: Targets = { lands: 36, ramp: 10, draw: 10, removal: 9, wipes: 3, finishers: 3 }
  if (settings.tags.includes('Aggro')) {
    t.lands = 34
    t.wipes = 1
    t.removal = 7
  }
  if (settings.tags.includes('Control')) {
    t.draw = 12
    t.removal = 11
    t.wipes = 5
  }
  if (settings.bracket >= 4) {
    t.lands -= 1
    t.ramp += 1
  }

  const personality = settings.personality
  if (personality === 'aggro') {
    t.finishers += 2
    t.ramp += 1
    t.lands = Math.max(33, t.lands - 1)
  }
  if (personality === 'combo') {
    t.draw += 1
  }
  if (personality === 'control') {
    t.draw += 2
    t.removal += 1
    t.wipes += 1
  }
  if (personality === 'value') {
    t.draw += 1
  }
  if (personality === 'synergy') {
    t.finishers += 1
  }

  const landsMatter = isLandsMatter(settings)
  if (landsMatter) {
    t.lands += 2
    t.ramp = Math.max(5, t.ramp - 3)
  }

  t.ramp = Math.max(5, Math.min(15, Math.round(t.ramp * profileScale(profile.ramp))))
  t.draw = Math.max(5, Math.min(15, Math.round(t.draw * profileScale(profile.draw))))
  t.removal = Math.max(4, Math.min(15, Math.round(t.removal * profileScale(profile.interaction))))
  t.wipes = Math.max(1, Math.min(7, Math.round(t.wipes * profileScale(profile.interaction))))

  const meta = settings.meta ?? []
  if (meta.includes('Aggro-heavy')) {
    t.wipes += 2
    t.removal += 1
  }
  if (meta.includes('Midrange-heavy')) {
    t.draw += 1
    t.removal += 1
  }
  if (meta.includes('Combo-heavy')) {
    t.removal += 2
  }
  if (meta.includes('Battlecruiser')) {
    t.wipes = Math.max(1, t.wipes - 1)
    t.finishers += 1
    t.ramp += 1
  }
  if (meta.includes('Stax-heavy')) {
    t.removal += 1
  }

  const rampDelta = t.ramp - 8
  const landFloor = landsMatter ? 37 : 31
  const landCeiling = landsMatter ? 42 : 39
  t.lands = Math.max(landFloor, Math.min(landCeiling, Math.round(t.lands - rampDelta * 0.6)))
  return t
}

interface TechPackage {
  category: Category
  query: string
  reason: string
  need: number
}

function metaTechPackages(meta: string[]): TechPackage[] {
  const packs: TechPackage[] = []
  if (meta.includes('Aggro-heavy')) {
    packs.push({
      category: 'Board Wipes',
      query: '(o:"destroy all creatures" or o:"deals damage to each creature" or o:"all creatures get -")',
      reason: 'Meta answer for aggro-heavy tables.',
      need: 6,
    })
  }
  if (meta.includes('Combo-heavy')) {
    packs.push({
      category: 'Removal',
      query: '(o:"counter target spell" or o:"can\'t cast spells" or o:"opponents can\'t cast")',
      reason: 'Stack interaction for combo-heavy tables.',
      need: 6,
    })
    packs.push({
      category: 'Removal',
      query: '(o:exile (o:"graveyard" or o:"graveyards")) mv<=3',
      reason: 'Graveyard hate for combo-heavy tables.',
      need: 4,
    })
  }
  if (meta.includes('Midrange-heavy')) {
    packs.push({
      category: 'Synergy',
      query: '(o:"whenever" o:"draw a card") -t:land',
      reason: 'Grindy value engine for midrange-heavy tables.',
      need: 5,
    })
  }
  if (meta.includes('Stax-heavy')) {
    packs.push({
      category: 'Removal',
      query: '(o:"destroy target artifact" or o:"destroy target enchantment" or o:"artifact or enchantment")',
      reason: 'Artifact and enchantment hate for stax-heavy tables.',
      need: 6,
    })
  }
  return packs
}

function profileTechPackages(profile: PowerProfile, options: BuildSettings['options']): TechPackage[] {
  const packs: TechPackage[] = []
  if (profile.tutors >= 60 && !options.avoidTutors) {
    packs.push({
      category: 'Synergy',
      query: 'o:"search your library for a card" mv<=4',
      reason: 'Tutor density boost from your power profile.',
      need: Math.round((profile.tutors - 50) / 12),
    })
  }
  if (profile.combo >= 60 && !options.avoidCombos) {
    packs.push({
      category: 'Synergy',
      query: '(o:"untap all" or o:"untap target permanent" or o:"copy target spell" or o:"storm")',
      reason: 'Combo enabler from your power profile.',
      need: Math.round((profile.combo - 50) / 12),
    })
  }
  if (profile.resiliency >= 60) {
    packs.push({
      category: 'Synergy',
      query: '(o:hexproof or o:indestructible or o:ward or o:"can\'t be countered" or o:"return target creature card from your graveyard to the battlefield")',
      reason: 'Protection package from your resiliency setting.',
      need: Math.round((profile.resiliency - 50) / 12),
    })
  }
  return packs
}

function gameChangerTarget(bracket: number): number {
  if (bracket <= 2) return 0
  if (bracket === 3) return 3
  if (bracket === 4) return 8
  return 12
}

export async function generateDeck(
  settings: BuildSettings,
  onProgress: ProgressFn
): Promise<Deck> {
  const { commander } = settings
  const partner = settings.partner ?? null
  const identity = unionIdentity(commander, partner)
  const colorless = identity.length === 0
  const commanderNames = partner ? [commander.name, partner.name] : [commander.name]
  const cap = budgetCap(settings.budget, settings.budgetCaps)
  const profile = settings.powerProfile ?? DEFAULT_PROFILE
  const avoidCombosEffective = settings.options.avoidCombos || profile.combo <= 30
  const avoidTutorsEffective = settings.options.avoidTutors || profile.tutors <= 30
  const neverSet = new Set((settings.neverInclude ?? []).map((n) => n.toLowerCase()))
  const ruleQuery = rulesToQuery(settings.rules)
  const targets = buildTargets(settings, profile)
  const landsMatter = isLandsMatter(settings)
  const noSpoilers = !!settings.options.noSpoilers
  const personality = settings.personality ?? 'custom'
  const weights = resolveWeights(personality, settings.options)
  const deck: DeckCard[] = [
    { card: commander, category: 'Commander', qty: 1, reason: 'Your commander.' },
  ]
  if (partner) {
    deck.push({ card: partner, category: 'Commander', qty: 1, reason: 'Your partner commander.' })
  }
  const used = new Set<string>(commanderNames)

  let mustLands = 0
  for (const card of settings.mustInclude ?? []) {
    if (used.has(card.name) || !fitsIdentity(card, identity)) continue
    const cat = categorize(card)
    used.add(card.name)
    deck.push({ card, category: cat, qty: 1, reason: 'Pinned by you as a must-include.' })
    if (cat === 'Lands') mustLands++
    else if (cat === 'Ramp') targets.ramp = Math.max(0, targets.ramp - 1)
    else if (cat === 'Card Draw') targets.draw = Math.max(0, targets.draw - 1)
    else if (cat === 'Removal') targets.removal = Math.max(0, targets.removal - 1)
    else if (cat === 'Board Wipes') targets.wipes = Math.max(0, targets.wipes - 1)
    else if (cat === 'Finishers') targets.finishers = Math.max(0, targets.finishers - 1)
  }

  const gcTarget = gameChangerTarget(settings.bracket)
  const gcAlready = deck.filter((d) => d.category !== 'Commander' && d.card.game_changer).length
  let gcNeed = Math.max(0, gcTarget - gcAlready)
  if (gcNeed > 0) {
    const priceClause = cap === Infinity ? '' : `usd<=${cap}`
    const gcPool = await searchCards(
      `${identityQuery(identity, commanderNames)} is:gamechanger ${priceClause} ${ruleQuery}`.trim(),
      { order: 'edhrec', max: 50 }
    )
    for (const card of gcPool) {
      if (gcNeed <= 0) break
      if (used.has(card.name)) continue
      if (!isLegal(card, noSpoilers) || !fitsIdentity(card, identity)) continue
      if (!cardMatchesRules(card, settings.rules)) continue
      if (cardPrice(card) > cap) continue
      if (neverSet.has(card.name.toLowerCase())) continue
      if (colorless && deadInColorless(card)) continue
      if (avoidTutorsEffective && isTutor(card)) continue
      if (avoidCombosEffective && settings.bracket <= 3 && isComboPiece(card)) continue
      const cat = categorize(card)
      used.add(card.name)
      deck.push({
        card,
        category: cat,
        qty: 1,
        reason: 'A Game Changer — a high-impact staple pulled in for this bracket.',
      })
      gcNeed--
      if (cat === 'Lands') mustLands++
      else if (cat === 'Ramp') targets.ramp = Math.max(0, targets.ramp - 1)
      else if (cat === 'Card Draw') targets.draw = Math.max(0, targets.draw - 1)
      else if (cat === 'Removal') targets.removal = Math.max(0, targets.removal - 1)
      else if (cat === 'Board Wipes') targets.wipes = Math.max(0, targets.wipes - 1)
      else if (cat === 'Finishers') targets.finishers = Math.max(0, targets.finishers - 1)
    }
  }

  onProgress(0, deck)

  const slugs =
    settings.themeSlugs ??
    settings.themes.map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
  let baseSlug = commanderSlug(commander.name)
  let basePage: EdhrecPage | null = null
  if (partner) {
    const a = commanderSlug(commander.name)
    const b = commanderSlug(partner.name)
    for (const pairSlug of [`${a}-${b}`, `${b}-${a}`]) {
      basePage = await fetchEdhrecPageBySlug(pairSlug)
      if (basePage) {
        baseSlug = pairSlug
        break
      }
    }
  } else {
    basePage = await fetchEdhrecPageBySlug(baseSlug)
  }
  const fallbackPages: (EdhrecPage | null)[] = []
  if (!basePage && partner) {
    fallbackPages.push(await fetchEdhrecPageBySlug(commanderSlug(commander.name)))
    fallbackPages.push(await fetchEdhrecPageBySlug(commanderSlug(partner.name)))
  }
  const themePages = await Promise.all(
    slugs.slice(0, 2).map((s) => fetchEdhrecPageBySlug(baseSlug, s))
  )
  const themeNameSet = new Set<string>()
  for (const page of themePages) {
    for (const rec of page?.recs ?? []) themeNameSet.add(rec.name)
  }
  const pages = [basePage, ...fallbackPages, ...themePages]
  const recMap = new Map<string, EdhrecRec>()
  for (const page of pages) {
    for (const rec of page?.recs ?? []) {
      const prev = recMap.get(rec.name)
      if (!prev || rec.synergy > prev.synergy) recMap.set(rec.name, rec)
    }
  }

  const resolved = await resolveCards([...recMap.keys()])

  const pool = new Map<Category, Candidate[]>()
  const addCandidate = (card: ScryCard, score: number, reason: string, cat?: Category) => {
    if (!isLegal(card, noSpoilers) || !fitsIdentity(card, identity)) return
    if (offColorFetchLand(card, identity)) return
    if (/\bBasic\b/.test(card.type_line)) return
    if (card.game_changer) return
    if (colorless && deadInColorless(card)) return
    if (neverSet.has(card.name.toLowerCase())) return
    if (!cardMatchesRules(card, settings.rules)) return
    if (cardPrice(card) > cap) return
    if (avoidTutorsEffective && isTutor(card)) return
    if (avoidCombosEffective && settings.bracket <= 3 && isComboPiece(card)) return
    if (settings.bracket <= 3 && isMassLandDenial(card)) return
    const category = cat ?? categorize(card)
    let adjScore = score
    if (landsMatter && category === 'Ramp') {
      if (isLandRamp(card)) adjScore += 2.5
      else if (isManaRock(card)) adjScore -= 2
    }
    if (category === 'Lands') adjScore += landFixingScore(card, identity, cap)
    const list = pool.get(category) ?? []
    if (list.some((c) => c.card.name === card.name)) return
    list.push({ card, score: adjScore, reason })
    pool.set(category, list)
  }

  const leadName = partner
    ? `${commander.name.split(',')[0]} & ${partner.name.split(',')[0]}`
    : commander.name.split(',')[0]
  for (const [name, rec] of recMap) {
    const card = resolved.get(name)
    if (!card) continue
    const inclusionPct = Math.round(rec.inclusion * 100)
    const synergyPct = Math.round(rec.synergy * 100)
    const reason =
      `Played in ${inclusionPct}% of ${leadName} decks on EDHREC` +
      (synergyPct > 0 ? `, with +${synergyPct}% synergy for this commander.` : '.')
    const category = categorize(card)
    const score = finalScore(
      {
        synergy: rec.synergy,
        inclusion: rec.inclusion,
        isTheme: themeNameSet.has(name),
        price: cardPrice(card),
        cap,
        cmc: card.cmc,
        category,
        personality,
      },
      weights
    )
    addCandidate(card, score, reason, category)
  }

  const base = `${identityQuery(identity, commanderNames)} ${ruleQuery}`.trim()
  const scoreScry = (card: ScryCard, cat: Category, isTheme = false): number =>
    finalScore(
      {
        synergy: 0,
        inclusion: rankInclusion(card.edhrec_rank),
        isTheme,
        price: cardPrice(card),
        cap,
        cmc: card.cmc,
        category: cat,
        personality,
      },
      weights
    )
  const fillFromScryfall = async (
    cat: Category,
    query: string,
    reason: string,
    need: number,
    isTheme = false
  ) => {
    const have = pool.get(cat)?.length ?? 0
    if (have >= need) return
    const extra = await searchCards(`${base} ${query} usd<=${cap === Infinity ? 1000 : cap}`, {
      max: Math.min(60, (need - have) * 3),
    })
    for (const card of extra) {
      addCandidate(card, scoreScry(card, cat, isTheme), reason, cat)
    }
  }

  onProgress(1, deck)

  await fillFromScryfall('Lands', '-t:basic t:land', 'A strong land for this color identity.', 30)

  // At unconstrained budget, explicitly add the original dual lands for these
  // colors. They have no drawback but low EDHREC inclusion (price), so they'd
  // never make the search-driven pool on their own.
  if (!Number.isFinite(cap)) {
    const idSet = new Set(identity)
    const wanted = ORIGINAL_DUAL_LANDS.filter((d) => d.colors.every((c) => idSet.has(c))).map(
      (d) => d.name
    )
    if (wanted.length) {
      const dualCards = await resolveCards(wanted)
      const reason = 'A premium original dual land — untapped, no-drawback fixing.'
      for (const name of wanted) {
        const card = dualCards.get(name)
        if (!card) continue
        // Guaranteed top-tier via a flat dominating score: these are the best
        // fixing in the game and there are at most three per identity. EDHREC
        // rank / price / produced_mana are often stripped by data fallbacks, so
        // scoring signals can't be trusted. Bump the existing candidate if the
        // recs already surfaced it (addCandidate dedups by name).
        const list = pool.get('Lands') ?? []
        const existing = list.find((c) => c.card.name === card.name)
        if (existing) {
          existing.score = 50
          existing.reason = reason
        } else {
          addCandidate(card, 50, reason, 'Lands')
        }
      }
    }
  }

  const take = (cat: Category, count: number): DeckCard[] => {
    const list = (pool.get(cat) ?? []).sort((a, b) => b.score - a.score)
    const out: DeckCard[] = []
    for (const cand of list) {
      if (out.length >= count) break
      if (used.has(cand.card.name)) continue
      used.add(cand.card.name)
      out.push({ card: cand.card, category: cat, qty: 1, reason: cand.reason })
    }
    return out
  }

  const utilityLandCount = Math.min(
    targets.lands - minBasics(identity),
    identity.length >= 3 ? 22 : 16
  )
  const lands = take('Lands', Math.max(4, Math.max(8, utilityLandCount) - mustLands))
  deck.push(...lands)
  onProgress(2, deck)

  await fillFromScryfall('Ramp', '(o:"{T}: Add" or o:"search your library for a basic land") -t:land mv<=4', 'Mana acceleration to deploy threats ahead of schedule.', targets.ramp + 4)
  await fillFromScryfall('Card Draw', 'o:"draw" o:"card" -t:land mv<=5', 'Card advantage to keep your hand full.', targets.draw + 4)
  await fillFromScryfall('Removal', '(o:"destroy target" or o:"exile target") mv<=4', 'Interaction for opposing threats.', targets.removal + 3)
  await fillFromScryfall('Board Wipes', '(o:"destroy all" or o:"exile all")', 'A reset button when the board gets out of hand.', targets.wipes + 2)

  const themeQueries: string[] = settings.themes.map((t) => themeQuery(t))
  for (const tag of settings.tags) {
    if (TAG_QUERIES[tag]) themeQueries.push(TAG_QUERIES[tag])
  }
  if (settings.tags.includes('Tribal')) {
    const tribe = detectTribe(commander.type_line, cardOracle(commander), settings.themes)
    if (tribe) themeQueries.push(`t:${tribe.toLowerCase()}`)
  }
  for (const q of themeQueries.slice(0, 4)) {
    await fillFromScryfall('Synergy', `${q} -t:land`, 'Directly supports your chosen theme.', 40, true)
  }
  if (settings.options.latestSets) {
    const fresh = await searchCards(`${base} -t:land year>=2024 usd<=${cap === Infinity ? 1000 : cap}`, {
      order: 'released',
      dir: 'desc',
      max: 20,
    })
    for (const card of fresh) {
      const cat = categorize(card)
      addCandidate(card, scoreScry(card, cat), 'A strong recent printing for this strategy.', cat)
    }
  }
  await fillFromScryfall('Finishers', '(pow>=6 or o:"wins the game") t:creature', 'Closes out the game once you are ahead.', targets.finishers + 2)

  const techPackages = [
    ...metaTechPackages(settings.meta ?? []),
    ...profileTechPackages(profile, settings.options),
  ]
  for (const pack of techPackages) {
    if (pack.need <= 0) continue
    const tech = await searchCards(
      `${base} ${pack.query} usd<=${cap === Infinity ? 1000 : cap}`,
      { max: Math.min(40, pack.need * 4) }
    )
    let boosted = 0
    for (const card of tech) {
      if (boosted >= pack.need) break
      const list = pool.get(pack.category) ?? []
      const existing = list.find((c) => c.card.name === card.name)
      if (existing) {
        existing.score += 0.6
        existing.reason = `${pack.reason} ${existing.reason}`
        boosted++
        continue
      }
      const before = list.length
      addCandidate(card, scoreScry(card, pack.category) + 0.6, pack.reason, pack.category)
      if ((pool.get(pack.category)?.length ?? 0) > before) boosted++
    }
  }

  deck.push(...take('Ramp', targets.ramp))
  deck.push(...take('Card Draw', targets.draw))
  deck.push(...take('Removal', targets.removal))
  deck.push(...take('Board Wipes', targets.wipes))
  deck.push(...take('Finishers', targets.finishers))
  onProgress(3, deck)

  const nonLandSlots = (partner ? 98 : 99) - targets.lands
  let remaining = nonLandSlots - deck.filter((d) => d.category !== 'Lands' && d.category !== 'Commander').length
  const maxExpensive = settings.tags.includes('Aggro') ? 6 : settings.bracket >= 4 ? 9 : 12
  const synergyList = (pool.get('Synergy') ?? []).sort((a, b) => b.score - a.score)
  let expensiveCount = deck.filter((d) => d.card.cmc >= 5 && d.category !== 'Lands').length
  for (const cand of synergyList) {
    if (remaining <= 0) break
    if (used.has(cand.card.name)) continue
    if (cand.card.cmc >= 5) {
      if (expensiveCount >= maxExpensive) continue
      expensiveCount++
    }
    used.add(cand.card.name)
    deck.push({ card: cand.card, category: 'Synergy', qty: 1, reason: cand.reason })
    remaining--
  }
  if (remaining > 0) {
    for (const cat of ['Ramp', 'Card Draw', 'Removal', 'Finishers'] as Category[]) {
      if (remaining <= 0) break
      const extra = take(cat, remaining)
      deck.push(...extra)
      remaining -= extra.length
    }
  }
  // Pull generic staples in the color identity to top off any remaining slots.
  // `respectRules` false is the relaxation pass: if the user's Card Rules are so
  // tight that even the filler can't reach 100 cards, we drop the rules for the
  // leftover slots so the deck is always complete.
  const runFiller = async (query: string, reason: string, respectRules: boolean) => {
    if (remaining <= 0) return
    const filler = await searchCards(query, { max: remaining * 3 })
    for (const card of filler) {
      if (remaining <= 0) break
      if (used.has(card.name) || !isLegal(card) || cardPrice(card) > cap) continue
      if (card.game_changer) continue
      if (colorless && deadInColorless(card)) continue
      if (neverSet.has(card.name.toLowerCase())) continue
      if (respectRules && !cardMatchesRules(card, settings.rules)) continue
      used.add(card.name)
      deck.push({
        card,
        category: categorize(card) === 'Lands' ? 'Synergy' : categorize(card),
        qty: 1,
        reason,
      })
      remaining--
    }
  }

  const priceClause = `usd<=${cap === Infinity ? 1000 : cap}`
  await runFiller(`${base} -t:land ${priceClause}`, 'A widely played card in these colors.', true)
  if (remaining > 0 && ruleQuery) {
    await runFiller(
      `${identityQuery(identity, commanderNames)} -t:land ${priceClause}`,
      'Added to complete the deck — your Card Rules were too strict to fill all 100 cards.',
      false
    )
  }
  onProgress(4, deck)

  const landCount = deck.filter((d) => d.category === 'Lands').reduce((n, d) => n + d.qty, 0)
  const basicsNeeded = Math.max(0, targets.lands - landCount)
  const basics = await buildBasics(identity, deck, basicsNeeded, settings.options.snowBasics)
  deck.push(...basics)

  const finalDeck = deck.filter(
    (d, i) => deck.findIndex((x) => x.card.name === d.card.name) === i || /^(Snow-Covered )?(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(d.card.name)
  )

  let resultDeck = finalDeck
  if (settings.bracket <= 3) {
    resultDeck = await pruneTwoCardCombos(finalDeck, {
      commander,
      partner,
      settings,
      pool,
      used,
      identity,
      colorless,
      neverSet,
      cap,
      base,
      noSpoilers,
    })
  }

  const power = estimatePower(settings, resultDeck)
  const wantsAttractions = usesAttractions(commander) || (!!partner && usesAttractions(partner))
  const attractions = wantsAttractions ? await buildAttractions() : undefined
  return {
    commander,
    cards: resultDeck,
    settings,
    power,
    description: describeDeck(settings, power),
    ...(attractions && attractions.length ? { attractions } : {}),
  }
}

interface PruneCtx {
  commander: ScryCard
  partner: ScryCard | null
  settings: BuildSettings
  pool: Map<Category, Candidate[]>
  used: Set<string>
  identity: string[]
  colorless: boolean
  neverSet: Set<string>
  cap: number
  base: string
  noSpoilers: boolean
}

async function pruneTwoCardCombos(finalDeck: DeckCard[], ctx: PruneCtx): Promise<DeckCard[]> {
  const { commander, partner, settings, pool, used, identity, colorless, neverSet, cap, base, noSpoilers } = ctx
  try {
    const probe: Deck = { commander, cards: finalDeck, settings, power: 0, description: '' }
    const found = await findCombos(probe)
    const disallowed = found.included.filter(
      (combo) => settings.bracket < comboMinBracket(combo, finalDeck)
    )
    if (!disallowed.length) return finalDeck

    const protectedNames = new Set<string>([
      commander.name,
      ...(partner ? [partner.name] : []),
      ...(settings.mustInclude ?? []).map((c) => c.name),
    ])
    const remove = new Set<string>()
    for (const combo of disallowed) {
      if (combo.cards.some((n) => remove.has(n))) continue
      const removable = combo.cards.filter((n) => !protectedNames.has(n))
      if (!removable.length) continue
      const pick =
        removable.find((n) => {
          const entry = finalDeck.find((d) => d.card.name === n)
          return entry && entry.category !== 'Lands'
        }) ?? removable[0]
      remove.add(pick)
    }
    if (!remove.size) return finalDeck

    const kept = finalDeck.filter((d) => !remove.has(d.card.name))
    const need = finalDeck.length - kept.length
    const comboNames = new Set(disallowed.flatMap((c) => c.cards))
    const deckNames = new Set(kept.map((d) => d.card.name))
    const replacements: DeckCard[] = []
    const reason = `Swapped in for a combo piece rated above Bracket ${settings.bracket} (fast two-card infinite, extra-turn chain, or similar).`

    const cats: Category[] = ['Synergy', 'Card Draw', 'Ramp', 'Removal', 'Finishers']
    for (const cat of cats) {
      if (replacements.length >= need) break
      const list = (pool.get(cat) ?? []).sort((a, b) => b.score - a.score)
      for (const cand of list) {
        if (replacements.length >= need) break
        const nm = cand.card.name
        if (used.has(nm) || deckNames.has(nm) || comboNames.has(nm)) continue
        if (isComboPiece(cand.card)) continue
        used.add(nm)
        deckNames.add(nm)
        replacements.push({ card: cand.card, category: cat, qty: 1, reason })
      }
    }

    if (replacements.length < need) {
      const filler = await searchCards(`${base} -t:land usd<=${cap === Infinity ? 1000 : cap}`, {
        max: (need - replacements.length) * 5,
      })
      for (const card of filler) {
        if (replacements.length >= need) break
        const nm = card.name
        if (used.has(nm) || deckNames.has(nm) || comboNames.has(nm)) continue
        if (!isLegal(card, noSpoilers) || !fitsIdentity(card, identity)) continue
        if (card.game_changer || cardPrice(card) > cap) continue
        if (colorless && deadInColorless(card)) continue
        if (neverSet.has(nm.toLowerCase())) continue
        if (isComboPiece(card)) continue
        used.add(nm)
        deckNames.add(nm)
        const cat = categorize(card)
        replacements.push({ card, category: cat === 'Lands' ? 'Synergy' : cat, qty: 1, reason })
      }
    }

    return [...kept, ...replacements]
  } catch {
    return finalDeck
  }
}

export function deckFromCards(
  commander: ScryCard,
  partner: ScryCard | null,
  mainCards: DeckCard[],
  name?: string
): Deck {
  const cards: DeckCard[] = [
    { card: commander, category: 'Commander', qty: 1, reason: 'Your commander.' },
    ...(partner
      ? [{ card: partner, category: 'Commander' as Category, qty: 1, reason: 'Your partner commander.' }]
      : []),
    ...mainCards.filter((d) => d.category !== 'Commander'),
  ]
  const estimatedBracket = estimateBracketFromCards(cards).bracket as 1 | 2 | 3 | 4 | 5
  const settings: BuildSettings = {
    commander,
    partner,
    bracket: estimatedBracket,
    budget: 'any',
    themes: [],
    tags: [],
    options: {
      includeStaples: true,
      prioritizeSynergy: true,
      avoidCombos: false,
      avoidTutors: false,
      latestSets: true,
      noSpoilers: false,
      allowUnsetCards: false,
      snowBasics: false,
    },
    powerProfile: DEFAULT_PROFILE,
    meta: [],
    mustInclude: [],
    neverInclude: [],
  }
  const power = estimatePower(settings, cards)
  const lead = name?.trim() || `${commander.name.split(',')[0]}'s deck`
  const description = `Analysis of ${lead} — a ${cards.length}-card list. Power, health, combos, and playtest stats are estimated from the cards in the deck.`
  return { commander, cards, settings, power, description }
}

const CATEGORY_QUERIES: Partial<Record<Category, string>> = {
  Lands: '-t:basic t:land',
  Ramp: '(o:"{T}: Add" or o:"search your library for a basic land") -t:land mv<=4',
  'Card Draw': 'o:"draw" o:"card" -t:land mv<=5',
  Removal: '(o:"destroy target" or o:"exile target") mv<=4',
  'Board Wipes': '(o:"destroy all" or o:"exile all")',
  Finishers: '(pow>=6 or o:"wins the game") t:creature',
  Synergy: '-t:land',
}

const BASIC_NAMES = /^(Snow-Covered )?(Plains|Island|Swamp|Mountain|Forest|Wastes)$/

function deckIdentityQuery(deck: Deck): string {
  const q = identityQuery(
    unionIdentity(deck.commander, deck.settings.partner),
    deck.cards.filter((d) => d.category === 'Commander').map((d) => d.card.name)
  )
  return `${q} ${rulesToQuery(deck.settings.rules)}`.trim()
}

export async function swapExpensiveCards(deck: Deck, maxPrice: number): Promise<{ deck: Deck; swapped: [string, string][] }> {
  const used = new Set(deck.cards.map((d) => d.card.name))
  const identity = unionIdentity(deck.commander, deck.settings.partner)
  const colorless = identity.length === 0
  const base = deckIdentityQuery(deck)
  const expensive = deck.cards.filter(
    (d) => d.category !== 'Commander' && !BASIC_NAMES.test(d.card.name) && cardPrice(d.card) > maxPrice
  )
  const swapped: [string, string][] = []
  const replacementPools = new Map<Category, ScryCard[]>()
  for (const cat of new Set(expensive.map((d) => d.category))) {
    const q = CATEGORY_QUERIES[cat] ?? '-t:land'
    replacementPools.set(
      cat,
      await searchCards(`${base} ${q} usd<=${maxPrice}`, { max: 80 })
    )
  }
  const newCards = deck.cards.map((d) => {
    if (!expensive.includes(d)) return d
    const pool = replacementPools.get(d.category) ?? []
    const replacement = pool.find(
      (c) =>
        !used.has(c.name) &&
        isLegal(c, !!deck.settings.options.noSpoilers) &&
        cardPrice(c) <= maxPrice &&
        !(colorless && deadInColorless(c)) &&
        !offColorFetchLand(c, identity)
    )
    if (!replacement) return d
    used.add(replacement.name)
    swapped.push([d.card.name, replacement.name])
    return {
      card: replacement,
      category: d.category,
      qty: d.qty,
      reason: `Budget-friendly stand-in for ${d.card.name}.`,
    }
  })
  return { deck: { ...deck, cards: newCards }, swapped }
}

export async function computeTieredUpgrades(deck: Deck): Promise<UpgradeTier[]> {
  const inDeck = new Set(deck.cards.map((d) => d.card.name))
  const usedOut = new Set<string>()
  const reservedIn = new Set<string>()
  const identity = unionIdentity(deck.commander, deck.settings.partner)
  const colorless = identity.length === 0
  const base = deckIdentityQuery(deck)

  const poolCats = ['Ramp', 'Card Draw', 'Removal', 'Board Wipes', 'Lands', 'Synergy', 'Finishers'] as Category[]
  const pools = new Map<Category, ScryCard[]>()
  for (const cat of poolCats) {
    const q = CATEGORY_QUERIES[cat] ?? '-t:land'
    pools.set(
      cat,
      await searchCards(`${base} ${q} usd<=500`, { max: 80, order: 'edhrec' })
    )
  }

  const outCandidates = deck.cards
    .filter((d) => d.category !== 'Commander' && !BASIC_NAMES.test(d.card.name))
    .sort((a, b) => (b.card.edhrec_rank ?? 99999) - (a.card.edhrec_rank ?? 99999))

  const tiers: { maxPrice: number; label: string }[] = [
    { maxPrice: 25, label: '$25 Upgrade' },
    { maxPrice: 50, label: '$50 Upgrade' },
    { maxPrice: 100, label: '$100 Upgrade' },
    { maxPrice: Infinity, label: 'Unlimited Upgrade' },
  ]

  const results: UpgradeTier[] = []

  for (const tier of tiers) {
    const cap = tier.maxPrice === Infinity ? 500 : tier.maxPrice
    const swaps: UpgradeSwap[] = []

    for (const out of outCandidates) {
      if (swaps.length >= 4) break
      if (usedOut.has(out.card.name)) continue
      const outPrice = cardPrice(out.card)
      const outRank = out.card.edhrec_rank ?? 25000
      if (outRank < 5000 && outPrice > 20) continue

      const pool = pools.get(out.category) ?? []
      const replacement = pool.find((c) => {
        if (inDeck.has(c.name) || reservedIn.has(c.name)) return false
        if (!isLegal(c, !!deck.settings.options.noSpoilers)) return false
        if (colorless && deadInColorless(c)) return false
        if (offColorFetchLand(c, identity)) return false
        const p = cardPrice(c)
        if (p <= outPrice || p > cap) return false
        const inRank = c.edhrec_rank ?? 20000
        return inRank < outRank - 800
      })
      if (!replacement) continue

      const inRank = replacement.edhrec_rank ?? 15000
      const powerGain = Math.max(0.1, Math.min(1.5, (outRank - inRank) / 15000))

      usedOut.add(out.card.name)
      reservedIn.add(replacement.name)
      swaps.push({
        outName: out.card.name.split(' //')[0],
        outPrice,
        in: replacement,
        inPrice: cardPrice(replacement),
        powerGain: Math.round(powerGain * 10) / 10,
        note: `Upgrades ${out.category.toLowerCase()} slot with a higher-EDHREC staple.`,
      })
    }

    results.push({ maxPrice: tier.maxPrice, label: tier.label, swaps })
  }

  return results
}

export async function computeUpgrades(deck: Deck): Promise<{ card: ScryCard; note: string }[]> {
  const cap = budgetCap(deck.settings.budget, deck.settings.budgetCaps)
  const used = new Set(deck.cards.map((d) => d.card.name))
  const colorless = unionIdentity(deck.commander, deck.settings.partner).length === 0
  const base = deckIdentityQuery(deck)
  const priceFilter = cap === Infinity ? 'usd>10' : `usd>${cap}`
  const candidates = await searchCards(`${base} -t:basic ${priceFilter}`, { max: 30 })
  return candidates
    .filter((c) => !used.has(c.name) && isLegal(c) && !(colorless && deadInColorless(c)))
    .slice(0, 8)
    .map((card) => ({
      card,
      note:
        cap === Infinity
          ? 'A premium staple worth testing in this shell.'
          : 'Excluded by your budget cap, but a clear power boost.',
    }))
}

function minBasics(identity: string[]): number {
  return Math.max(8, 18 - identity.length * 3)
}

const BASIC_FOR_COLOR: Record<string, string> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
}

async function buildBasics(
  identity: string[],
  deck: DeckCard[],
  count: number,
  snow = false
): Promise<DeckCard[]> {
  if (count <= 0) return []
  // No Snow-Covered Wastes exists, so colorless decks always use plain Wastes.
  const snowName = (basic: string) => (snow ? `Snow-Covered ${basic}` : basic)
  const names = identity.length
    ? identity.map((c) => BASIC_FOR_COLOR[c]).filter(Boolean).map(snowName)
    : ['Wastes']
  const pips: Record<string, number> = {}
  for (const d of deck) {
    if (d.category === 'Lands') continue
    const cost = cardManaCost(d.card)
    for (const c of identity) {
      pips[c] = (pips[c] ?? 0) + (cost.match(new RegExp(`\\{[^}]*${c}[^}]*\\}`, 'g'))?.length ?? 0)
    }
  }
  const totalPips = Object.values(pips).reduce((a, b) => a + b, 0) || 1
  const resolved = await resolveCards(names)
  const out: DeckCard[] = []
  let assigned = 0
  names.forEach((name, i) => {
    const color = identity[i]
    const share = identity.length
      ? Math.round((count * (pips[color] ?? 1)) / totalPips)
      : count
    const qty = i === names.length - 1 ? count - assigned : Math.min(share, count - assigned)
    assigned += qty
    const card = resolved.get(name)
    if (card && qty > 0) {
      out.push({ card, category: 'Lands', qty, reason: 'Basic land for consistent mana.' })
    }
  })
  return out
}

function estimatePower(settings: BuildSettings, deck: DeckCard[]): number {
  const bracketBase: Record<number, number> = { 1: 3.5, 2: 5, 3: 6.5, 4: 8, 5: 9 }
  let power = bracketBase[settings.bracket]
  const avgRank =
    deck
      .filter((d) => d.card.edhrec_rank)
      .reduce((s, d) => s + (d.card.edhrec_rank ?? 0), 0) /
    Math.max(1, deck.filter((d) => d.card.edhrec_rank).length)
  if (avgRank < 4000) power += 0.5
  if (settings.budget === 'low') power -= 0.5
  if (settings.options.avoidTutors) power -= 0.25
  if (settings.options.avoidCombos) power -= 0.25
  const profile = settings.powerProfile ?? DEFAULT_PROFILE
  power += (profile.combo - 50) / 100
  power += (profile.tutors - 50) / 200
  power += (profile.interaction - 50) / 200
  return Math.max(1, Math.min(10, Math.round(power * 2) / 2))
}

function describeDeck(settings: BuildSettings, power: number): string {
  const lead = settings.commander.name.split(',')[0]
  const name = settings.partner ? `${lead} & ${settings.partner.name.split(',')[0]}` : lead
  const themes = settings.themes.length ? settings.themes.join(' + ') : 'value and synergy'
  const styles: string[] = []
  const personality = settings.personality
  if (personality === 'aggro') styles.push('applies early pressure')
  if (personality === 'control') styles.push('controls the board until it can take over')
  if (personality === 'combo') styles.push('assembles compact combo lines')
  if (personality === 'value') styles.push('grinds out value in the midgame')
  if (personality === 'synergy') styles.push('maximizes commander and theme synergies')
  if (settings.tags.includes('Aggro')) styles.push('applies early pressure')
  if (settings.tags.includes('Control')) styles.push('controls the board until it can take over')
  if (settings.tags.includes('Topdeck')) styles.push('sculpts its draws from the top of the library')
  if (settings.tags.includes('Tribal')) styles.push('leans on tribal synergies')
  const uniqueStyles = [...new Set(styles)]
  const style = uniqueStyles.length
    ? uniqueStyles.join(' and ')
    : `builds toward a decisive ${themes} endgame`
  const bracketWord =
    settings.bracket <= 2 ? 'a relaxed, social' : settings.bracket === 3 ? 'a tuned mid-power' : 'a high-power'
  return `This ${name} deck focuses on ${themes}, and ${style}. It is built for ${bracketWord} table at roughly ${power}/10 power.`
}
