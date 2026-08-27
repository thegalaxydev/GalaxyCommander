import { useRef, useState } from 'react'
import type {
  AdvancedOptions,
  BudgetCaps,
  BudgetTier,
  DeckPersonality,
  PowerProfile,
  ScryCard,
} from '../types'
import type { MustIncludeCard } from '../types'
import { META_OPTIONS, allowsMultiples } from '../types'
import { SUGGESTED_THEMES, TAGS, describeTheme } from '../themes'
import type { EdhrecTheme } from '../edhrec'
import { CommanderSearch } from './CommanderSearch'
import { CardPicker } from './CardPicker'
import { SetPriority } from './SetPriority'
import { PartnerDiscovery } from './PartnerDiscovery'
import { partnerMode, partnerSearchFilter, unionIdentity } from '../partner'
import { WUBRG as ALL_COLORS, combineRulebreakers, splashOptions } from '../rulebreaker'
import { DEFAULT_DECK_SIZE, MAX_DECK_SIZE } from '../generator'
import { fetchNamedCard, fetchRandomCommander } from '../scryfall'
import { PERSONALITY_PRESETS } from '../personality'

interface Props {
  commander: ScryCard | null
  onCommander: (card: ScryCard | null) => void
  partner: ScryCard | null
  onPartner: (card: ScryCard | null) => void
  bracket: number
  onBracket: (b: 1 | 2 | 3 | 4 | 5) => void
  budget: BudgetTier
  onBudget: (b: BudgetTier) => void
  budgetCaps?: BudgetCaps
  themes: string[]
  onThemes: (t: string[]) => void
  edhrecThemes: EdhrecTheme[]
  tags: string[]
  onTags: (t: string[]) => void
  options: AdvancedOptions
  onOptions: (o: AdvancedOptions) => void
  profile: PowerProfile
  onProfile: (p: PowerProfile) => void
  personality: DeckPersonality
  onPersonality: (p: DeckPersonality) => void
  onApplyPersonality: (id: Exclude<DeckPersonality, 'custom'>) => void
  meta: string[]
  onMeta: (m: string[]) => void
  mustInclude: MustIncludeCard[]
  onMustInclude: (cards: MustIncludeCard[]) => void
  neverInclude: ScryCard[]
  onNeverInclude: (cards: ScryCard[]) => void
  rules: string
  onRules: (rules: string) => void
  preferredSets: string[]
  onPreferredSets: (codes: string[]) => void
  splashColor: string | null
  onSplashColor: (c: string | null) => void
  rulebreakerColors: string[]
  onRulebreakerColors: (colors: string[]) => void
  deckSize: number
  onDeckSize: (n: number) => void
  disabled: boolean
}

const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const

const COLOR_COMBO_NAMES: Record<string, string> = {
  W: 'Mono-White',
  U: 'Mono-Blue',
  B: 'Mono-Black',
  R: 'Mono-Red',
  G: 'Mono-Green',
  WU: 'Azorius',
  WB: 'Orzhov',
  WR: 'Boros',
  WG: 'Selesnya',
  UB: 'Dimir',
  UR: 'Izzet',
  UG: 'Simic',
  BR: 'Rakdos',
  BG: 'Golgari',
  RG: 'Gruul',
  WUB: 'Esper',
  WUR: 'Jeskai',
  WUG: 'Bant',
  WBR: 'Mardu',
  WBG: 'Abzan',
  WRG: 'Naya',
  UBR: 'Grixis',
  UBG: 'Sultai',
  URG: 'Temur',
  BRG: 'Jund',
  WUBR: 'Yore-Tiller',
  WUBG: 'Witch-Maw',
  WURG: 'Ink-Treader',
  WBRG: 'Dune-Brood',
  UBRG: 'Glint-Eye',
  WUBRG: 'Five-Color',
}

function colorComboName(colors: string[]): string {
  const key = WUBRG.filter((c) => colors.includes(c)).join('')
  return COLOR_COMBO_NAMES[key] ?? key
}

const BUDGET_LABELS: { value: BudgetTier; label: string }[] = [
  { value: 'low', label: '$' },
  { value: 'mid', label: '$$' },
  { value: 'high', label: '$$$' },
  { value: 'any', label: 'Any' },
]

const OPTION_LABELS: { key: keyof AdvancedOptions; label: string }[] = [
  { key: 'includeStaples', label: 'Include Staples' },
  { key: 'prioritizeSynergy', label: 'Prioritize Synergy' },
  { key: 'avoidCombos', label: 'Avoid Infinite Combos' },
  { key: 'avoidTutors', label: 'Avoid Tutors' },
  { key: 'latestSets', label: 'Use Latest Sets' },
  { key: 'noSpoilers', label: 'No Spoilers (released cards only)' },
  { key: 'allowUnsetCards', label: 'Allow Unset / Illegal Cards' },
  { key: 'snowBasics', label: 'Use Snow-Covered Basics' },
]

const PROFILE_LABELS: { key: keyof PowerProfile; label: string }[] = [
  { key: 'ramp', label: 'Ramp Priority' },
  { key: 'interaction', label: 'Interaction Density' },
  { key: 'draw', label: 'Card Draw Density' },
  { key: 'combo', label: 'Combo Focus' },
  { key: 'tutors', label: 'Tutor Density' },
  { key: 'resiliency', label: 'Resiliency' },
]

export function Sidebar(props: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [setsOpen, setSetsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [customTheme, setCustomTheme] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [randomColors, setRandomColors] = useState<string[]>([])

  const toggleRandomColor = (c: string) =>
    setRandomColors((cur) => {
      const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur.filter((x) => x !== 'C'), c]
      return WUBRG.filter((x) => next.includes(x))
    })

  const toggleColorless = () =>
    setRandomColors((cur) => (cur.includes('C') ? [] : ['C']))

  const rollRandomCommander = async () => {
    setRolling(true)
    try {
      const card = await fetchRandomCommander(randomColors)
      if (card) props.onCommander(card)
    } finally {
      setRolling(false)
    }
  }
  const mode = props.commander ? partnerMode(props.commander) : null
  const identity = props.commander ? unionIdentity(props.commander, props.partner) : undefined
  const rulebreaker = props.commander
    ? combineRulebreakers(props.commander, props.partner)
    : null
  // Only "any color identity" grants are narrowable; a splash grant already has
  // its own single-color picker, and the land clauses have no color to choose.
  const anyColorGrants = rulebreaker?.grants.filter((g) => g.scope === 'any') ?? []
  const offColors = identity ? ALL_COLORS.filter((c) => !identity.includes(c)) : []
  const identityName = identity?.length ? identity.join('') : 'colorless'
  // Chips read as an alphabetical list regardless of the order cards were added.
  const byName = (a: string, b: string) =>
    a.split(' //')[0].localeCompare(b.split(' //')[0], undefined, { sensitivity: 'base' })
  const sortedMust = [...props.mustInclude].sort((a, b) => byName(a.card.name, b.card.name))
  const sortedNever = [...props.neverInclude].sort((a, b) => byName(a.name, b.name))
  const setPinQty = (pin: MustIncludeCard, qty: number) =>
    props.onMustInclude(
      props.mustInclude.map((p) =>
        p.card.name === pin.card.name ? { ...p, qty: clampPinQty(qty) } : p
      )
    )

  const toggleRulebreakerColor = (c: string) => {
    const on = props.rulebreakerColors.includes(c)
    const next = on
      ? props.rulebreakerColors.filter((x) => x !== c)
      : [...props.rulebreakerColors, c]
    props.onRulebreakerColors(ALL_COLORS.filter((x) => next.includes(x)))
  }
  const [themeTip, setThemeTip] = useState<{ text: string; x: number; y: number } | null>(null)

  const showThemeTip = (theme: string, e: React.MouseEvent) => {
    const count = props.edhrecThemes.find((t) => t.name === theme)?.count
    const rect = e.currentTarget.getBoundingClientRect()
    setThemeTip({
      text: describeTheme(theme, count),
      x: rect.right + 10,
      y: Math.min(rect.top, window.innerHeight - 130),
    })
  }

  const toggleMeta = (m: string) => {
    props.onMeta(
      props.meta.includes(m) ? props.meta.filter((x) => x !== m) : [...props.meta, m]
    )
  }

  const toggleTheme = (theme: string) => {
    if (props.themes.includes(theme)) {
      props.onThemes(props.themes.filter((t) => t !== theme))
    } else if (props.themes.length < 3) {
      props.onThemes([...props.themes, theme])
    }
  }

  const toggleTag = (tag: string) => {
    props.onTags(
      props.tags.includes(tag) ? props.tags.filter((t) => t !== tag) : [...props.tags, tag]
    )
  }

  const themeOptions: string[] = props.edhrecThemes.length
    ? props.edhrecThemes.slice(0, 8).map((t) => t.name)
    : [...SUGGESTED_THEMES.slice(0, 8)]
  const allThemes = [...new Set([...props.themes, ...themeOptions])]

  return (
    <aside className={`sidebar ${props.disabled ? 'is-disabled' : ''}`}>
      <section>
        <h2>Commander</h2>
        <CommanderSearch
          commander={props.commander}
          onSelect={(c) => props.onCommander(c ?? null)}
        />
        <div className="color-filter" role="group" aria-label="Random commander color identity">
          {WUBRG.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-pip ${randomColors.includes(c) ? 'active' : ''}`}
              onClick={() => toggleRandomColor(c)}
              aria-pressed={randomColors.includes(c)}
            >
              <i className={`ms ms-${c.toLowerCase()} ms-cost`} />
            </button>
          ))}
          <button
            type="button"
            className={`color-pip ${randomColors.includes('C') ? 'active' : ''}`}
            onClick={toggleColorless}
            aria-pressed={randomColors.includes('C')}
            title="Colorless"
          >
            <i className="ms ms-c ms-cost" />
          </button>
        </div>
        <button
          type="button"
          className="random-commander"
          onClick={rollRandomCommander}
          disabled={rolling || props.disabled}
        >
          {rolling
            ? 'Rolling…'
            : `🎲 ${props.commander ? 'Reroll' : 'Random'} ${
                randomColors.includes('C')
                  ? 'Colorless'
                  : randomColors.length
                    ? colorComboName(randomColors)
                    : 'Any'
              } Commander`}
        </button>
      </section>

      {props.commander && mode && (
        <section>
          <h2>
            Partner <span className="badge">{mode.label}</span>
          </h2>
          <PartnerDiscovery
            commander={props.commander}
            partner={props.partner}
            onSelect={props.onPartner}
            disabled={props.disabled}
          />
          {mode.kind === 'partner-with' && !props.partner ? (
            <button
              className="theme-row add"
              onClick={async () => {
                const card = await fetchNamedCard(mode.withName!)
                if (card) props.onPartner(card)
              }}
            >
              + Add {mode.withName}
            </button>
          ) : (
            <CommanderSearch
              commander={props.partner}
              onSelect={(c) => props.onPartner(c ?? null)}
              baseFilter={partnerSearchFilter(mode)}
              excludeName={props.commander.name}
              placeholder={
                mode.kind === 'background'
                  ? 'Search background...'
                  : mode.kind === 'doctor'
                    ? 'Search companion...'
                    : mode.kind === 'companion'
                      ? 'Search Doctor...'
                      : 'Search partner...'
              }
            />
          )}
        </section>
      )}

      {rulebreaker && (
        <section className="rulebreaker">
          <h2>Rulebreaker</h2>
          {rulebreaker.text.map((line) => (
            <p key={line} className="rulebreaker-text">
              {line}
            </p>
          ))}
          {rulebreaker.needsSplashColor && identity && (
            <>
              <h3 className="rule-head">Splash Color</h3>
              <div className="color-filter" role="group" aria-label="Rulebreaker splash color">
                {splashOptions(identity).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-pip ${props.splashColor === c ? 'active' : ''}`}
                    onClick={() => props.onSplashColor(props.splashColor === c ? null : c)}
                    aria-pressed={props.splashColor === c}
                  >
                    <i className={`ms ms-${c.toLowerCase()} ms-cost`} />
                  </button>
                ))}
              </div>
              {!props.splashColor && (
                <p className="hint">
                  Pick a color to unlock it for {rulebreaker.grants[0]?.label ?? 'the exempt cards'}.
                </p>
              )}
            </>
          )}
          {anyColorGrants.length > 0 && identity && (
            <>
              <h3 className="rule-head">Off-Color Cards</h3>
              <div className="color-filter" role="group" aria-label="Rulebreaker off-colors">
                {offColors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-pip ${props.rulebreakerColors.includes(c) ? 'active' : ''}`}
                    onClick={() => toggleRulebreakerColor(c)}
                    aria-pressed={props.rulebreakerColors.includes(c)}
                  >
                    <i className={`ms ms-${c.toLowerCase()} ms-cost`} />
                  </button>
                ))}
              </div>
              <p className="hint">
                {offColors.every((c) => props.rulebreakerColors.includes(c))
                  ? `Any color of ${anyColorGrants[0].label} can be included, as printed.`
                  : offColors.some((c) => props.rulebreakerColors.includes(c))
                    ? `Only these colors of ${anyColorGrants[0].label} will be considered.`
                    : `Off-color ${anyColorGrants[0].label} are switched off — the deck stays in ${identityName}.`}
              </p>
            </>
          )}
          {rulebreaker.noMaxDeckSize && (
            <>
              <h3 className="rule-head">Deck Size</h3>
              <label className="slider-row">
                <span>
                  Cards <em>{props.deckSize}</em>
                </span>
                <input
                  type="range"
                  min={DEFAULT_DECK_SIZE}
                  max={MAX_DECK_SIZE}
                  step={10}
                  value={props.deckSize}
                  onChange={(e) => props.onDeckSize(Number(e.target.value))}
                />
              </label>
              <p className="hint">This commander removes the 100-card maximum.</p>
            </>
          )}
        </section>
      )}

      <section>
        <h2>Playstyle</h2>
        <div className="personality-group">
          {PERSONALITY_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`personality-chip ${props.personality === p.id ? 'active' : ''}`}
              onClick={() => props.onApplyPersonality(p.id)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className={`personality-chip ${props.personality === 'custom' ? 'active' : ''}`}
            onClick={() => props.onPersonality('custom')}
          >
            Custom
          </button>
        </div>
        {props.personality !== 'custom' && (
          <p className="hint">
            {PERSONALITY_PRESETS.find((p) => p.id === props.personality)?.hint}
          </p>
        )}
      </section>

      <section>
        <h2>Bracket</h2>
        <div className="seg-group">
          {([1, 2, 3, 4, 5] as const).map((b) => (
            <button
              key={b}
              className={`seg ${props.bracket === b ? 'active' : ''}`}
              onClick={() => props.onBracket(b)}
            >
              {b}
            </button>
          ))}
        </div>
        <p className="hint">
          {['Exhibition', 'Core', 'Upgraded', 'Optimized', 'cEDH'][props.bracket - 1]}
        </p>
      </section>

      <section>
        <h2>Budget</h2>
        <div className="seg-group">
          {BUDGET_LABELS.map(({ value, label }) => {
            const cap =
              value !== 'any' && props.budgetCaps ? props.budgetCaps[value] : undefined
            return (
              <button
                key={value}
                className={`seg ${props.budget === value ? 'active' : ''}`}
                onClick={() => props.onBudget(value)}
                title={
                  value === 'any'
                    ? 'No price limit per card'
                    : cap != null
                      ? `Up to $${cap} per card`
                      : undefined
                }
              >
                {label}
              </button>
            )
          })}
        </div>
        {props.budget !== 'any' && props.budgetCaps && (
          <p className="hint budget-cap-hint">
            Max ${props.budgetCaps[props.budget]} per card · change in Settings → Budget tiers
          </p>
        )}
      </section>

      <section>
        <h2>
          Theme{' '}
          {props.edhrecThemes.length > 0 && <span className="badge">from EDHREC</span>}
        </h2>
        <div className="theme-list">
          {allThemes.map((theme) => (
            <button
              key={theme}
              className={`theme-row ${props.themes.includes(theme) ? 'active' : ''}`}
              onClick={() => toggleTheme(theme)}
              onMouseEnter={(e) => showThemeTip(theme, e)}
              onMouseMove={(e) => showThemeTip(theme, e)}
              onMouseLeave={() => setThemeTip(null)}
            >
              {theme}
              {props.edhrecThemes.find((t) => t.name === theme) && (
                <small>
                  {props.edhrecThemes.find((t) => t.name === theme)!.count.toLocaleString()} decks
                </small>
              )}
            </button>
          ))}
          {showCustom ? (
            <form
              className="custom-theme"
              onSubmit={(e) => {
                e.preventDefault()
                if (customTheme.trim()) {
                  toggleTheme(customTheme.trim())
                  setCustomTheme('')
                  setShowCustom(false)
                }
              }}
            >
              <input
                autoFocus
                value={customTheme}
                placeholder="e.g. Poison"
                onChange={(e) => setCustomTheme(e.target.value)}
                onBlur={() => !customTheme && setShowCustom(false)}
              />
            </form>
          ) : (
            <button className="theme-row add" onClick={() => setShowCustom(true)}>
              + Custom Theme
            </button>
          )}
        </div>
      </section>

      <section>
        <h2>Tags</h2>
        <div className="tag-group">
          {TAGS.map((tag) => (
            <button
              key={tag}
              className={`tag ${props.tags.includes(tag) ? 'active' : ''}`}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Expected Meta</h2>
        <div className="tag-group">
          {META_OPTIONS.map((m) => (
            <button
              key={m}
              className={`tag ${props.meta.includes(m) ? 'active' : ''}`}
              onClick={() => toggleMeta(m)}
            >
              {m}
            </button>
          ))}
        </div>
        {props.meta.length > 0 && (
          <p className="hint">The generator will pack tech cards for these tables.</p>
        )}
      </section>

      <section>
        <button className="advanced-toggle" onClick={() => setProfileOpen(!profileOpen)}>
          Power Profile {profileOpen ? '▾' : '▸'}
        </button>
        {profileOpen && (
          <div className="profile-list">
            {PROFILE_LABELS.map(({ key, label }) => (
              <label key={key} className="slider-row">
                <span>
                  {label} <em>{props.profile[key]}%</em>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={props.profile[key]}
                  onChange={(e) => {
                    props.onPersonality('custom')
                    props.onProfile({ ...props.profile, [key]: Number(e.target.value) })
                  }}
                />
              </label>
            ))}
            <p className="hint">50% is neutral. Sliders fine-tune the deck within its bracket.</p>
          </div>
        )}
      </section>

      <section>
        <button className="advanced-toggle" onClick={() => setRulesOpen(!rulesOpen)}>
          Card Rules{' '}
          {props.mustInclude.length + props.neverInclude.length + (props.rules.trim() ? 1 : 0) > 0 && (
            <span className="badge">
              {props.mustInclude.length + props.neverInclude.length + (props.rules.trim() ? 1 : 0)}
            </span>
          )}{' '}
          {rulesOpen ? '▾' : '▸'}
        </button>
        {rulesOpen && (
          <div className="card-rules">
            <h3 className="rule-head must">Must Include</h3>
            <CardPicker
              placeholder="Search a card to pin..."
              identity={identity}
              rulebreaker={rulebreaker}
              rulebreakerChoices={{
                splash: props.splashColor,
                colors: props.rulebreakerColors,
              }}
              exclude={props.mustInclude.map((p) => p.card.name)}
              onPick={(card) => props.onMustInclude([...props.mustInclude, { card, qty: 1 }])}
            />
            <div className="rule-chips">
              {sortedMust.map((pin) => {
                const overSingleton = pin.qty > 1 && !allowsMultiples(pin.card)
                return (
                  <span key={pin.card.name} className="rule-chip must">
                    {pin.card.name.split(' //')[0]}
                    <PinQty
                      qty={pin.qty}
                      illegal={overSingleton}
                      oversized={pin.qty > props.deckSize - 1}
                      title={
                        overSingleton
                          ? `A Commander deck can only run one ${pin.card.name.split(' //')[0]}. The generator will still add ${pin.qty}.`
                          : 'Copies to include'
                      }
                      onChange={(qty) => setPinQty(pin, qty)}
                    />
                    <button
                      title="Unpin"
                      onClick={() =>
                        props.onMustInclude(
                          props.mustInclude.filter((p) => p.card.name !== pin.card.name)
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
            {props.mustInclude.some((p) => p.qty > 1 && !allowsMultiples(p.card)) && (
              <p className="hint">
                ⚠ Only basic lands and cards that say &quot;any number of cards named…&quot; may be
                run as more than one copy. Those pins will still be honoured.
              </p>
            )}
            {props.mustInclude.some((p) => p.qty > props.deckSize - 1) && (
              <p className="hint">
                ⚠ A pin asks for more copies than the deck has slots, so the finished deck will be
                bigger than {props.deckSize} cards.
              </p>
            )}
            <h3 className="rule-head never">Never Include</h3>
            <CardPicker
              placeholder="Search a card to ban..."
              exclude={props.neverInclude.map((c) => c.name)}
              onPick={(card) => props.onNeverInclude([...props.neverInclude, card])}
            />
            <div className="rule-chips">
              {sortedNever.map((card) => (
                <span key={card.name} className="rule-chip never">
                  {card.name.split(' //')[0]}
                  <button
                    onClick={() =>
                      props.onNeverInclude(props.neverInclude.filter((c) => c.name !== card.name))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <h3 className="rule-head filter">Scryfall Filters</h3>
            <input
              type="text"
              className="rule-filter-input"
              placeholder="e.g. t:Legendary -t:Land mv<=4"
              value={props.rules}
              onChange={(e) => props.onRules(e.target.value)}
            />
            <p className="hint">
              Full{' '}
              <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noreferrer">
                Scryfall search syntax
              </a>
              , applied to every card added. Space-separated terms all must match;{' '}
              <code>-</code> excludes, <code>or</code> and <code>( )</code> combine,{' '}
              <code>!</code> matches an exact name, and <code>/…/</code> is a regex.
            </p>
            <p className="hint">
              Types <code>t:</code> · text <code>o:</code> <code>fo:</code> <code>kw:</code> ·
              colors <code>c:</code> <code>id:</code> <code>produces:</code>{' '}
              <code>devotion:</code> · mana <code>m:</code> <code>mv:</code> · stats{' '}
              <code>pow:</code> <code>tou:</code> <code>pt:</code> <code>loy:</code> · printing{' '}
              <code>r:</code> <code>e:</code> <code>st:</code> <code>cn:</code>{' '}
              <code>border:</code> <code>frame:</code> <code>stamp:</code> <code>lang:</code> ·
              legality <code>f:</code> <code>banned:</code> <code>restricted:</code> ·{' '}
              <code>year:</code> <code>date:</code> <code>usd:</code> <code>eur:</code>{' '}
              <code>tix:</code> <code>edhrecrank:</code> · flavor <code>a:</code>{' '}
              <code>ft:</code> <code>wm:</code> · plus <code>is:</code> / <code>not:</code> and{' '}
              <code>has:</code>.
            </p>
          </div>
        )}
      </section>

      <section>
        <button className="advanced-toggle" onClick={() => setSetsOpen(!setsOpen)}>
          Preferred Sets{' '}
          {props.preferredSets.length > 0 && (
            <span className="badge">{props.preferredSets.length}</span>
          )}{' '}
          {setsOpen ? '▾' : '▸'}
        </button>
        {setsOpen && (
          <div className="card-rules">
            <SetPriority
              value={props.preferredSets}
              onChange={props.onPreferredSets}
              disabled={props.disabled}
            />
            <p className="hint">
              Every card in the finished deck is printed from the highest set on this list that
              has it, and those printings carry into .cod and .txt exports. Art only — it never
              changes which cards the generator picks.
            </p>
          </div>
        )}
      </section>

      <section>
        <button className="advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}>
          Advanced Options {advancedOpen ? '▾' : '▸'}
        </button>
        {advancedOpen && (
          <div className="advanced-list">
            {OPTION_LABELS.map(({ key, label }) => (
              <label key={key} className="check-row">
                <input
                  type="checkbox"
                  checked={props.options[key]}
                  onChange={(e) =>
                    props.onOptions({ ...props.options, [key]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        )}
      </section>
      {themeTip && (
        <div className="theme-tip" style={{ left: themeTip.x, top: themeTip.y }}>
          {themeTip.text}
        </div>
      )}
    </aside>
  )
}

/**
 * There is no rules limit on how many copies you can pin, so the only bound is
 * the largest deck the generator will build — past that the number could not
 * fit in any deck it could produce.
 */
function clampPinQty(qty: number): number {
  return Math.max(1, Math.min(MAX_DECK_SIZE, Math.round(qty)))
}

/**
 * Copy count on a Must Include chip: type a number or step it with the buttons.
 * The typed value is held as a draft string so a half-finished entry (or a
 * cleared field) isn't clamped back to 1 on every keystroke — it commits on
 * blur or Enter, and Escape reverts.
 */
function PinQty({
  qty,
  illegal,
  oversized,
  title,
  onChange,
}: {
  qty: number
  illegal: boolean
  /** More copies than the deck has room for — the deck will overflow its size. */
  oversized: boolean
  title: string
  onChange: (qty: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  // Escape blurs the field, and blur fires before React re-renders the cleared
  // draft — without this the discarded text would be committed on the way out.
  const reverting = useRef(false)

  const step = (delta: number) => {
    setDraft(null)
    onChange(clampPinQty(qty + delta))
  }

  const commit = (raw: string) => {
    setDraft(null)
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) onChange(clampPinQty(n))
  }

  return (
    <span className={`pin-qty ${illegal || oversized ? 'illegal' : ''}`} title={title}>
      <button type="button" title="One fewer copy" disabled={qty <= 1} onClick={() => step(-1)}>
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label="Copies"
        value={draft ?? String(qty)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onBlur={(e) => {
          if (reverting.current) {
            reverting.current = false
            setDraft(null)
            return
          }
          commit(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') {
            reverting.current = true
            setDraft(null)
            e.currentTarget.blur()
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            step(1)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            step(-1)
          }
        }}
      />
      {(illegal || oversized) && <span className="pin-warn">⚠</span>}
      <button
        type="button"
        title="One more copy"
        disabled={qty >= MAX_DECK_SIZE}
        onClick={() => step(1)}
      >
        +
      </button>
    </span>
  )
}
