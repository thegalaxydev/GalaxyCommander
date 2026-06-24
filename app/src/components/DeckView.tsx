import { useEffect, useRef, useState } from 'react'
import type { ComboInfo, Deck, DeckCard, ScryCard, UpgradeTier } from '../types'
import { CATEGORY_ORDER } from '../types'
import { cardImage, cardImageByName, cardPrice } from '../scryfall'
import { analyzeDeck, avgCmc, comboTagInfo, deckHealth, estimateBracket } from '../analysis'
import type { AppSettings } from '../settings'
import {
  generateOverview,
  generatePlayGuide,
  llmConfigured,
  type PlayGuideSections,
} from '../llmChat'
import { ManaCost } from './ManaCost'
import { PlaytestPanel } from './PlaytestPanel'
import { CardDetailPanel } from './CardDetailPanel'
import { SvgIcon } from './Icons'
import { CATEGORY_ICONS, identityInfo } from '../iconData'
import { unionIdentity } from '../partner'
import type { VariantKind } from '../chat'

const TABS = ['Overview', 'Decklist', 'Combos', 'Playtest', 'Upgrade Paths', 'Play Guide'] as const
type Tab = (typeof TABS)[number]

interface Props {
  deck: Deck
  combos: { included: ComboInfo[]; almost: ComboInfo[] } | null
  combosLoading: boolean
  upgrades: UpgradeTier[]
  onVariant: (kind: VariantKind) => void
  generating: boolean
  simIterations: number
  disableCardPreviews: boolean
  settings: AppSettings
}

type AiState<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: T | null
  error?: string
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed'
}

interface Hover {
  src: string
  y: number
}

export function DeckView({
  deck,
  combos,
  combosLoading,
  upgrades,
  onVariant,
  generating,
  simIterations,
  disableCardPreviews,
  settings,
}: Props) {
  const [tab, setTab] = useState<Tab>('Overview')
  const [hover, setHover] = useState<Hover | null>(null)
  const [selected, setSelected] = useState<DeckCard | null>(null)
  const [aiOverview, setAiOverview] = useState<AiState<string>>({ status: 'idle', data: null })
  const [aiGuide, setAiGuide] = useState<AiState<PlayGuideSections>>({ status: 'idle', data: null })
  const canAi = llmConfigured(settings) && !generating
  const deckRef = useRef(deck)

  useEffect(() => {
    deckRef.current = deck
    setAiOverview({ status: 'idle', data: null })
    setAiGuide({ status: 'idle', data: null })
  }, [deck])

  const runOverview = () => {
    const target = deck
    setAiOverview({ status: 'loading', data: null })
    generateOverview(target, settings)
      .then((text) => {
        if (deckRef.current === target) setAiOverview({ status: 'ready', data: text })
      })
      .catch((err) => {
        if (deckRef.current === target)
          setAiOverview({ status: 'error', data: null, error: errText(err) })
      })
  }

  const runGuide = () => {
    const target = deck
    setAiGuide({ status: 'loading', data: null })
    generatePlayGuide(target, settings)
      .then((sections) => {
        if (deckRef.current === target) setAiGuide({ status: 'ready', data: sections })
      })
      .catch((err) => {
        if (deckRef.current === target)
          setAiGuide({ status: 'error', data: null, error: errText(err) })
      })
  }

  const showHover = (card: ScryCard, e: React.MouseEvent) => {
    const src = cardImage(card, 'normal')
    if (src) setHover({ src, y: Math.min(e.clientY, window.innerHeight - 360) })
  }

  const showHoverName = (name: string, e: React.MouseEvent) => {
    setHover({ src: cardImageByName(name, 'normal'), y: Math.min(e.clientY, window.innerHeight - 360) })
  }

  return (
    <div className={`deck-view ${generating ? 'generating' : ''}`}>
      <nav className="deck-tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
            {t === 'Combos' && combos && combos.included.length > 0 && (
              <span className="tab-badge">{combos.included.length}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="deck-tab-body">
        {tab === 'Overview' && (
          <Overview
            deck={deck}
            combos={combos}
            ai={aiOverview}
            canAi={canAi}
            onGenerate={runOverview}
          />
        )}
        {tab === 'Decklist' && (
          <Decklist
            deck={deck}
            selected={selected}
            onSelect={setSelected}
            onHover={showHover}
            onLeave={() => setHover(null)}
          />
        )}
        {tab === 'Combos' && (
          <Combos
            combos={combos}
            loading={combosLoading}
            bracket={deck.settings.bracket}
            onHover={showHoverName}
            onLeave={() => setHover(null)}
          />
        )}
        {tab === 'Playtest' && <PlaytestPanel deck={deck} simIterations={simIterations} />}
        {tab === 'Upgrade Paths' && (
          <Upgrades upgrades={upgrades} combos={combos} onHover={showHover} onLeave={() => setHover(null)} />
        )}
        {tab === 'Play Guide' && (
          <PlayGuide deck={deck} ai={aiGuide} canAi={canAi} onGenerate={runGuide} />
        )}
      </div>

      <div className="variants-bar">
        <span>Generate Variant</span>
        {(
          [
            ['casual', 'More Casual'],
            ['competitive', 'More Competitive'],
            ['budget', 'More Budget'],
            ['thematic', 'More Thematic'],
          ] as [VariantKind, string][]
        ).map(([kind, label]) => (
          <button key={kind} disabled={generating} onClick={() => onVariant(kind)}>
            {label}
          </button>
        ))}
      </div>

      {hover && !selected && !disableCardPreviews && (
        <img className="card-preview" src={hover.src} style={{ top: hover.y }} alt="" />
      )}
      {selected && tab === 'Decklist' && (
        <CardDetailPanel deck={deck} card={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function Overview({
  deck,
  combos,
  ai,
  canAi,
  onGenerate,
}: {
  deck: Deck
  combos: { included: ComboInfo[]; almost: ComboInfo[] } | null
  ai: AiState<string>
  canAi: boolean
  onGenerate: () => void
}) {
  const { strengths, weaknesses } = analyzeDeck(deck)
  const health = deckHealth(deck, combos)
  const warnings = health.filter((h) => h.level === 'warn')
  const bracketEst = estimateBracket(deck, combos)
  const partner = deck.settings.partner
  const identity = identityInfo(unionIdentity(deck.commander, partner))
  return (
    <div className="overview">
      <div
        className={`overview-art ${partner ? 'split' : ''}`}
        style={{ backgroundImage: `url(${cardImage(deck.commander, 'art_crop')})` }}
      >
        {partner && (
          <div
            className="overview-art-partner"
            style={{ backgroundImage: `url(${cardImage(partner, 'art_crop')})` }}
          />
        )}
        <div className="overview-art-fade" />
        <div className="overview-title">
          <h2>
            {deck.commander.name.split(' //')[0]}
            {partner && <span className="partner-name"> &amp; {partner.name.split(' //')[0]}</span>}
          </h2>
          <p>
            <span className="identity-badge">
              {identity.icon && <SvgIcon name={identity.icon} size={15} />}
              {identity.name}
            </span>{' '}
            ·{' '}
            {deck.settings.themes.length
              ? deck.settings.themes.join(' / ')
              : 'Synergy & Value'}{' '}
            · Bracket {deck.settings.bracket} · Power {deck.power}/10
          </p>
        </div>
      </div>
      {ai.status === 'ready' && ai.data ? (
        <div className="overview-desc ai-text">
          <div className="ai-head">
            <span className="ai-tag">AI overview</span>
            {canAi && (
              <button type="button" className="ai-regen" onClick={onGenerate}>
                ↻ Regenerate
              </button>
            )}
          </div>
          {ai.data.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para.trim()}</p>
          ))}
        </div>
      ) : (
        <>
          <p className="overview-desc">{deck.description}</p>
          {canAi && (
            <div className="ai-actions">
              <button
                type="button"
                className="ai-generate"
                onClick={onGenerate}
                disabled={ai.status === 'loading'}
              >
                {ai.status === 'loading' ? 'Generating…' : '✨ Generate AI overview'}
              </button>
              {ai.status === 'error' && (
                <span className="ai-error">{ai.error || 'Failed'}</span>
              )}
            </div>
          )}
        </>
      )}
      <div className="perceived-bracket">
        <span className={`pb-badge b${bracketEst.bracket}`}>
          Perceived Bracket {bracketEst.bracket} · {bracketEst.label}
        </span>
        <span className="pb-reasons">{bracketEst.reasons.join(' · ')}</span>
      </div>
      <div className="overview-cols">
        <div>
          <h3>Strengths</h3>
          <ul className="pro-list">
            {strengths.map((s) => (
              <li key={s}>✓ {s}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Weaknesses</h3>
          <ul className="con-list">
            {weaknesses.map((w) => (
              <li key={w}>✗ {w}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="deck-health">
        <h3>
          Deck Health{' '}
          <span className={`health-badge ${warnings.length ? 'warn' : 'ok'}`}>
            {warnings.length ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : 'All clear'}
          </span>
        </h3>
        <div className="health-list">
          {health.map((item) => (
            <details key={item.message} className={`health-item ${item.level}`}>
              <summary>
                {item.level === 'warn' ? '⚠' : '✓'} {item.message}
              </summary>
              <p>{item.detail}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  )
}

function Decklist({
  deck,
  selected,
  onSelect,
  onHover,
  onLeave,
}: {
  deck: Deck
  selected: DeckCard | null
  onSelect: (card: DeckCard | null) => void
  onHover: (card: ScryCard, e: React.MouseEvent) => void
  onLeave: () => void
}) {
  const gameChangers = deck.cards.filter((d) => d.card.game_changer)
  const gcNames = new Set(gameChangers.map((d) => d.card.name))
  const groups = CATEGORY_ORDER.map((cat) => ({
    cat,
    cards: deck.cards.filter((d) => d.category === cat && !gcNames.has(d.card.name)),
  })).filter((g) => g.cards.length)

  const renderRow = (d: DeckCard) => (
    <div
      key={d.card.name}
      className={`deck-row ${selected?.card.name === d.card.name ? 'selected' : ''}`}
      onClick={() => onSelect(selected?.card.name === d.card.name ? null : d)}
      onMouseEnter={(e) => onHover(d.card, e)}
      onMouseLeave={onLeave}
    >
      <span className="deck-qty">{d.qty}</span>
      <span className="deck-name">
        {d.card.name.split(' //')[0]}
        {d.card.game_changer && (
          <span className="gc-badge" title="On the Commander Game Changers list">
            GC
          </span>
        )}
      </span>
      <ManaCost cost={d.card.mana_cost ?? d.card.card_faces?.[0]?.mana_cost ?? ''} />
      <span className="deck-price">
        {cardPrice(d.card) > 0 ? `$${cardPrice(d.card).toFixed(2)}` : ''}
      </span>
    </div>
  )

  return (
    <div className="decklist">
      <p className="hint decklist-hint">Click a card to see why it was included.</p>
      <div className="decklist-cols">
        {gameChangers.length > 0 && (
          <section className="deck-group game-changers">
            <h3>
              ⚡ Game Changers ({gameChangers.reduce((n, d) => n + d.qty, 0)})
            </h3>
            <p className="gc-note">
              Bracket-defining cards. Brackets 1–2 allow none, Bracket 3 allows up to 3, Bracket
              4+ unlimited.
            </p>
            {gameChangers.map(renderRow)}
          </section>
        )}
        {groups.map((g) => (
          <section key={g.cat} className="deck-group">
            <h3>
              <SvgIcon name={CATEGORY_ICONS[g.cat]} size={13} /> {g.cat} (
              {g.cards.reduce((n, d) => n + d.qty, 0)})
            </h3>
            {g.cards.map(renderRow)}
          </section>
        ))}
        {deck.attractions && deck.attractions.length > 0 && (
          <section className="deck-group">
            <h3>
              🎡 Attractions ({deck.attractions.reduce((n, d) => n + d.qty, 0)})
            </h3>
            <p className="gc-note">
              A separate Attraction deck — exported to the sideboard, not part of the 99.
            </p>
            {deck.attractions.map(renderRow)}
          </section>
        )}
      </div>
    </div>
  )
}

function isGameEndingCombo(c: ComboInfo): boolean {
  const text = `${c.produces.join(' ')} ${c.description}`.toLowerCase()
  return /infinite|win the game|each opponent loses|wins? the game/.test(text)
}

function Combos({
  combos,
  loading,
  bracket,
  onHover,
  onLeave,
}: {
  combos: { included: ComboInfo[]; almost: ComboInfo[] } | null
  loading: boolean
  bracket: number
  onHover: (name: string, e: React.MouseEvent) => void
  onLeave: () => void
}) {
  if (loading) return <p className="hint pad">Searching Commander Spellbook for combo lines...</p>
  if (!combos || (!combos.included.length && !combos.almost.length))
    return (
      <p className="hint pad">
        No known combos detected in this list. That is often intentional at lower brackets — try
        the More Competitive variant if you want compact win lines.
      </p>
    )
  const illegalCombos =
    bracket <= 3 ? combos.included.filter((c) => c.cards.length <= 2 && isGameEndingCombo(c)) : []
  return (
    <div className="combos">
      {illegalCombos.length > 0 && (
        <div className="combo-warning">
          ⚠ This Bracket {bracket} deck contains {illegalCombos.length} compact two-card win
          combo{illegalCombos.length > 1 ? 's' : ''}. Brackets 1–3 are not intended to run these —
          cut a piece or move to Bracket 4+.
        </div>
      )}
      {combos.included.length > 0 && <h3>In This Deck</h3>}
      {combos.included.map((c, i) => (
        <ComboCard key={i} combo={c} onHover={onHover} onLeave={onLeave} />
      ))}
      {combos.almost.length > 0 && <h3>Potential Combos (add 1–2 cards)</h3>}
      {combos.almost.map((c, i) => (
        <ComboCard key={`a${i}`} combo={c} onHover={onHover} onLeave={onLeave} />
      ))}
    </div>
  )
}

function ComboCard({
  combo,
  onHover,
  onLeave,
}: {
  combo: ComboInfo
  onHover: (name: string, e: React.MouseEvent) => void
  onLeave: () => void
}) {
  const tag = comboTagInfo(combo)
  return (
    <div className="combo-card">
      <span className="combo-badges">
        <span className="combo-count">{combo.cards.length}-card</span>
        {tag && (
          <span
            className={`combo-bracket bracket-${tag.code}`}
            title={`Commander Spellbook bracket tag: ${tag.name}`}
          >
            {tag.name}
            {tag.code === 'B' ? '' : ` · Bracket ${tag.bracket}+`}
          </span>
        )}
      </span>
      <div className="combo-pieces">
        {combo.cards.map((name) => (
          <span
            key={name}
            className={combo.missing?.includes(name) ? 'missing' : ''}
            onMouseEnter={(e) => onHover(name, e)}
            onMouseLeave={onLeave}
          >
            {name}
          </span>
        ))}
      </div>
      <div className="combo-result">
        <strong>Result:</strong> {combo.produces.join(', ') || 'See steps'}
      </div>
      {combo.description && (
        <details>
          <summary>How it works</summary>
          <p>{combo.description}</p>
        </details>
      )}
      {combo.missing && combo.missing.length > 0 && (
        <p className="combo-missing">Add {combo.missing.join(', ')} to enable this line.</p>
      )}
    </div>
  )
}

function Upgrades({
  upgrades,
  combos,
  onHover,
  onLeave,
}: {
  upgrades: UpgradeTier[]
  combos: { included: ComboInfo[]; almost: ComboInfo[] } | null
  onHover: (card: ScryCard, e: React.MouseEvent) => void
  onLeave: () => void
}) {
  const comboAdds = combos?.almost.flatMap((c) => c.missing ?? []) ?? []
  const hasSwaps = upgrades.some((t) => t.swaps.length > 0)
  if (!hasSwaps && !comboAdds.length)
    return (
      <p className="hint pad">
        This list is already running the strongest options for its constraints. Loosen the budget
        or raise the bracket to surface upgrade suggestions.
      </p>
    )
  return (
    <div className="upgrades">
      {upgrades.map((tier) => (
        <section key={tier.label} className="upgrade-tier">
          <h3>{tier.label}</h3>
          {tier.swaps.length === 0 ? (
            <p className="hint">No swaps found at this price point.</p>
          ) : (
            tier.swaps.map((swap) => (
              <div key={`${tier.label}-${swap.outName}-${swap.in.name}`} className="upgrade-swap">
                <div className="upgrade-swap-row">
                  <span className="upgrade-out">OUT: {swap.outName}</span>
                  <span className="upgrade-arrow">→</span>
                  <span
                    className="upgrade-in"
                    onMouseEnter={(e) => onHover(swap.in, e)}
                    onMouseLeave={onLeave}
                  >
                    IN: {swap.in.name.split(' //')[0]}
                  </span>
                </div>
                <div className="upgrade-swap-meta">
                  <span>${swap.outPrice.toFixed(2)} → ${swap.inPrice.toFixed(2)}</span>
                  <span className="upgrade-gain">Power +{swap.powerGain.toFixed(1)}</span>
                </div>
                <small>{swap.note}</small>
              </div>
            ))
          )}
        </section>
      ))}
      {comboAdds.length > 0 && (
        <>
          <h3>Combo Enablers</h3>
          <p className="hint">
            Adding {[...new Set(comboAdds)].join(', ')} would complete combo lines listed in the
            Combos tab.
          </p>
        </>
      )}
    </div>
  )
}

function PlayGuide({
  deck,
  ai,
  canAi,
  onGenerate,
}: {
  deck: Deck
  ai: AiState<PlayGuideSections>
  canAi: boolean
  onGenerate: () => void
}) {
  const curve = avgCmc(deck.cards)
  const ramp = deck.cards.filter((d) => d.category === 'Ramp').slice(0, 3)
  const draw = deck.cards.filter((d) => d.category === 'Card Draw').slice(0, 3)
  const finishers = deck.cards.filter((d) => d.category === 'Finishers')
  const themes = deck.settings.themes.join(' and ') || 'your synergy package'

  const g = ai.status === 'ready' ? ai.data : null

  const controls = canAi && (
    <div className="ai-actions">
      <button
        type="button"
        className="ai-generate"
        onClick={onGenerate}
        disabled={ai.status === 'loading'}
      >
        {ai.status === 'loading'
          ? 'Generating…'
          : g
            ? '↻ Regenerate AI guide'
            : '✨ Generate AI play guide'}
      </button>
      {g && <span className="ai-tag">AI play guide</span>}
      {ai.status === 'error' && <span className="ai-error">{ai.error || 'Failed'}</span>}
    </div>
  )

  if (g) {
    return (
      <div className="play-guide">
        {controls}
        {g.early && (
          <>
            <h3>Early Game (Turns 1–3)</h3>
            <p>{g.early}</p>
          </>
        )}
        {g.mid && (
          <>
            <h3>Mid Game (Turns 4–6)</h3>
            <p>{g.mid}</p>
          </>
        )}
        {g.late && (
          <>
            <h3>Late Game (Turn 7+)</h3>
            <p>{g.late}</p>
          </>
        )}
        {g.threats && (
          <>
            <h3>Threat Assessment</h3>
            <p>{g.threats}</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="play-guide">
      {controls}
      <h3>Early Game (Turns 1–3)</h3>
      <p>
        Prioritize lands and ramp. Ideal openers include{' '}
        {ramp.map((d) => d.card.name).join(', ') || 'your cheapest acceleration'}. Mulligan hands
        with fewer than 3 lands unless they contain multiple ramp pieces.
      </p>
      <h3>Mid Game (Turns 4–6)</h3>
      <p>
        Deploy {deck.commander.name.split(',')[0]} once you can use it the same turn or protect
        it. Start developing {themes} while holding up interaction for anything that threatens
        your engine. Keep cards flowing with{' '}
        {draw.map((d) => d.card.name).join(', ') || 'your draw engines'}.
      </p>
      <h3>Late Game (Turn 7+)</h3>
      <p>
        {finishers.length
          ? `Close with ${finishers.map((d) => d.card.name).join(', ')} once opponents have spent their answers.`
          : 'Win through accumulated synergy advantage and combat pressure.'}{' '}
        With an average mana value of {curve.toFixed(2)}, the deck hits its stride around turn
        6 — avoid overextending into board wipes before then.
      </p>
      <h3>Threat Assessment</h3>
      <p>
        Save spot removal for cards that disrupt {themes}. Board wipes are your reset valve —
        don't fire them off just to clear value creatures.
      </p>
    </div>
  )
}
