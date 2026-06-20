import { useState } from 'react'
import type { AdvancedOptions, BudgetTier, DeckPersonality, PowerProfile, ScryCard } from '../types'
import { META_OPTIONS } from '../types'
import { SUGGESTED_THEMES, TAGS } from '../themes'
import type { EdhrecTheme } from '../edhrec'
import { CommanderSearch } from './CommanderSearch'
import { CardPicker } from './CardPicker'
import { PartnerDiscovery } from './PartnerDiscovery'
import { partnerMode, partnerSearchFilter, unionIdentity } from '../partner'
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
  mustInclude: ScryCard[]
  onMustInclude: (cards: ScryCard[]) => void
  neverInclude: ScryCard[]
  onNeverInclude: (cards: ScryCard[]) => void
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
  { value: 'any', label: 'Any' },
  { value: 'low', label: '$' },
  { value: 'mid', label: '$$' },
  { value: 'high', label: '$$$' },
]

const OPTION_LABELS: { key: keyof AdvancedOptions; label: string }[] = [
  { key: 'includeStaples', label: 'Include Staples' },
  { key: 'prioritizeSynergy', label: 'Prioritize Synergy' },
  { key: 'avoidCombos', label: 'Avoid Infinite Combos' },
  { key: 'avoidTutors', label: 'Avoid Tutors' },
  { key: 'latestSets', label: 'Use Latest Sets' },
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
          {BUDGET_LABELS.map(({ value, label }) => (
            <button
              key={value}
              className={`seg ${props.budget === value ? 'active' : ''}`}
              onClick={() => props.onBudget(value)}
            >
              {label}
            </button>
          ))}
        </div>
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
          {props.mustInclude.length + props.neverInclude.length > 0 && (
            <span className="badge">{props.mustInclude.length + props.neverInclude.length}</span>
          )}{' '}
          {rulesOpen ? '▾' : '▸'}
        </button>
        {rulesOpen && (
          <div className="card-rules">
            <h3 className="rule-head must">Must Include</h3>
            <CardPicker
              placeholder="Search a card to pin..."
              identity={identity}
              exclude={props.mustInclude.map((c) => c.name)}
              onPick={(card) => props.onMustInclude([...props.mustInclude, card])}
            />
            <div className="rule-chips">
              {props.mustInclude.map((card) => (
                <span key={card.name} className="rule-chip must">
                  {card.name.split(' //')[0]}
                  <button
                    onClick={() =>
                      props.onMustInclude(props.mustInclude.filter((c) => c.name !== card.name))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <h3 className="rule-head never">Never Include</h3>
            <CardPicker
              placeholder="Search a card to ban..."
              exclude={props.neverInclude.map((c) => c.name)}
              onPick={(card) => props.onNeverInclude([...props.neverInclude, card])}
            />
            <div className="rule-chips">
              {props.neverInclude.map((card) => (
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
    </aside>
  )
}
