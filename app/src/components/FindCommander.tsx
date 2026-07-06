import { useRef, useState } from 'react'
import type { ScryCard } from '../types'
import { cardImage } from '../scryfall'
import { isLegendaryCreature } from '../packs/setPool'
import type { GeneratedPack, OpenedCard, SetInfo } from '../packs/types'
import { PackReveal } from './PackReveal'

interface Props {
  sets: SetInfo[]
  openPack: (set: SetInfo) => Promise<GeneratedPack>
  onChoose: (commander: ScryCard, pool: ScryCard[], generate: boolean) => void
  onEndHunt: (packs: GeneratedPack[], sets: SetInfo[]) => void
  disablePreviews?: boolean
}

export function FindCommander({ sets, openPack, onChoose, onEndHunt, disablePreviews }: Props) {
  const [chosen, setChosen] = useState<SetInfo[]>([])
  const [hunting, setHunting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pack, setPack] = useState<GeneratedPack | null>(null)
  const packsRef = useRef<GeneratedPack[]>([])
  const [tally, setTally] = useState({ packs: 0, legendaries: 0, mythics: 0 })
  const [found, setFound] = useState<ScryCard[]>([])

  const toggleSet = (set: SetInfo) =>
    setChosen((list) =>
      list.some((s) => s.code === set.code)
        ? list.filter((s) => s.code !== set.code)
        : [...list, set]
    )

  const nextPack = async () => {
    if (!chosen.length || busy) return
    setBusy(true)
    setError(null)
    try {
      const set = chosen[Math.floor(Math.random() * chosen.length)]
      const opened = await openPack(set)
      packsRef.current.push(opened)
      const legends = opened.cards
        .map((c) => c.card)
        .filter(isLegendaryCreature)
      setFound((f) => [
        ...f,
        ...legends.filter((l) => !f.some((x) => x.id === l.id)),
      ])
      setTally((t) => ({
        packs: t.packs + 1,
        legendaries: t.legendaries + legends.length,
        mythics: t.mythics + opened.cards.filter((c) => c.card.rarity === 'mythic').length,
      }))
      setPack(opened)
      setHunting(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open a pack.')
    } finally {
      setBusy(false)
    }
  }

  const huntPool = (): ScryCard[] => packsRef.current.flatMap((p) => p.cards.map((c: OpenedCard) => c.card))

  const finish = (commander: ScryCard | null, generate = false) => {
    if (packsRef.current.length) onEndHunt(packsRef.current, chosen)
    if (commander) onChoose(commander, huntPool(), generate)
    packsRef.current = []
    setPack(null)
    setHunting(false)
    setTally({ packs: 0, legendaries: 0, mythics: 0 })
    setFound([])
  }

  if (!hunting) {
    return (
      <div className="find-commander">
        <h2>Find Your Commander</h2>
        <p className="hint">
          Pick one or more sets, then open Play Boosters until a legendary creature speaks to you.
        </p>
        <div className="find-set-grid">
          {sets.slice(0, 60).map((set) => (
            <button
              key={set.code}
              type="button"
              className={`find-set-btn${chosen.some((s) => s.code === set.code) ? ' active' : ''}`}
              onClick={() => toggleSet(set)}
            >
              {set.icon_svg_uri && <img className="set-icon" src={set.icon_svg_uri} alt="" />}
              {set.name}
            </button>
          ))}
        </div>
        {error && <p className="pack-error">{error}</p>}
        <button
          type="button"
          className="open-pack-btn"
          disabled={!chosen.length || busy}
          onClick={() => void nextPack()}
        >
          {busy ? 'Opening…' : 'Start the Hunt'}
        </button>
      </div>
    )
  }

  return (
    <div className="find-commander hunting">
      <div className="find-tally">
        <span>
          Packs opened: <strong>{tally.packs}</strong>
        </span>
        <span>
          Legendaries found: <strong>{tally.legendaries}</strong>
        </span>
        <span>
          Mythics found: <strong>{tally.mythics}</strong>
        </span>
        <button type="button" className="new-build" onClick={() => finish(null)}>
          End Hunt
        </button>
      </div>
      <div className="find-body">
        <div className="find-reveal">
          {pack && (
            <PackReveal
              key={tally.packs}
              cards={pack.cards}
              packNumber={tally.packs}
              packCount={tally.packs}
              onNext={undefined}
              onDone={() => void nextPack()}
              autoFlip
              disablePreviews={disablePreviews}
            />
          )}
          {error && <p className="pack-error">{error}</p>}
          <button
            type="button"
            className="open-pack-btn"
            disabled={busy}
            onClick={() => void nextPack()}
          >
            {busy ? 'Opening…' : 'Open Another Pack'}
          </button>
        </div>
        <aside className="find-rail">
          <h3>Legendaries found</h3>
          {!found.length && <p className="hint">None yet — keep cracking.</p>}
          {found.map((card) => (
            <div key={card.id} className="find-legend">
              <img src={cardImage(card, 'art_crop')} alt="" />
              <div>
                <strong>{card.name.split(' //')[0]}</strong>
                <div className="find-legend-actions">
                  <button type="button" onClick={() => finish(card, false)}>
                    Build from pulls
                  </button>
                  <button type="button" onClick={() => finish(card, true)}>
                    Generate deck
                  </button>
                </div>
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  )
}
