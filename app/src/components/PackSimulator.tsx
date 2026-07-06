import { useEffect, useRef, useState } from 'react'
import type { ScryCard } from '../types'
import { codCardName, type CodDeck } from '../cod'
import { fetchPrecon, fetchPreconList } from '../mtgjson'
import { resolveCards } from '../edhrec'
import { checkAchievements, loadUnlocked, type UnlockedMap } from '../packs/achievements'
import { generatePack, generateProduct, PRODUCT_CONFIGS } from '../packs/collation'
import {
  addToCollection,
  loadCardMeta,
  loadCollection,
  resetCollection,
  type Collection,
} from '../packs/collectionStore'
import { loadSessions, deleteSession, recordSession, resolveSession } from '../packs/sessions'
import { fetchSetPool, fetchSets, relatedSetCodes } from '../packs/setPool'
import { loadStats, recordPacks, saveStats } from '../packs/stats'
import type {
  AchievementDef,
  CardMeta,
  GeneratedPack,
  PackSession,
  PackStats,
  ProductType,
  SetInfo,
} from '../packs/types'
import { FindCommander } from './FindCommander'
import { PackAchievements } from './PackAchievements'
import { PackCollection } from './PackCollection'
import { PackHistory } from './PackHistory'
import { PackReveal } from './PackReveal'
import { PackStatsDash } from './PackStatsDash'
import { SetPicker } from './SetPicker'

type Tab = 'open' | 'collection' | 'stats' | 'history' | 'achievements' | 'find'

const PRODUCTS: { type: ProductType; label: string; desc: string }[] = [
  { type: 'play', label: 'Play Booster', desc: '14 cards · real collation' },
  { type: 'collector', label: 'Collector Booster', desc: '15 cards · foil heavy' },
  { type: 'jumpstart', label: 'Jumpstart', desc: '20 cards · approximate' },
  { type: 'commander', label: 'Commander Deck', desc: 'A real precon from this set' },
  { type: 'bundle', label: 'Bundle', desc: '9 Play Boosters' },
  { type: 'box', label: 'Booster Box', desc: '36 Play Boosters' },
]

interface Opening {
  packs: GeneratedPack[]
  idx: number
  setName: string
  replay: boolean
}

interface Props {
  onOpenInBuilder: (cod: CodDeck) => void
  onGenerateFor: (card: ScryCard) => void
  disableCardPreviews?: boolean
}

export function PackSimulator({ onOpenInBuilder, onGenerateFor, disableCardPreviews }: Props) {
  const [tab, setTab] = useState<Tab>('open')
  const [sets, setSets] = useState<SetInfo[]>([])
  const [setsError, setSetsError] = useState<string | null>(null)
  const [set, setSet] = useState<SetInfo | null>(null)
  const [product, setProduct] = useState<ProductType>('play')
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<Opening | null>(null)

  const [collection, setCollection] = useState<Collection>(() => loadCollection())
  const [meta, setMeta] = useState<Record<string, CardMeta>>(() => loadCardMeta())
  const [stats, setStats] = useState<PackStats>(() => loadStats())
  const [sessions, setSessions] = useState<PackSession[]>(() => loadSessions())
  const [unlocked, setUnlocked] = useState<UnlockedMap>(() => loadUnlocked())
  const [toasts, setToasts] = useState<AchievementDef[]>([])
  const toastTimer = useRef<number | null>(null)

  useEffect(() => {
    fetchSets()
      .then((list) => {
        setSets(list)
        if (list.length) setSet((s) => s ?? list[0])
      })
      .catch(() => setSetsError('Could not load the set list. Check your connection and reload.'))
  }, [])

  useEffect(() => {
    if (!toasts.length) return
    toastTimer.current = window.setTimeout(() => setToasts((t) => t.slice(1)), 3500)
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [toasts])

  /** Persist an opened batch: collection, stats, session, achievements. */
  const commitPacks = (packs: GeneratedPack[], forSet: SetInfo, sessionName?: string) => {
    const openedCards = packs.flatMap((p) => p.cards)
    const stored = addToCollection(openedCards)
    if (!stored) {
      setError('Browser storage is full — this opening was shown but only partially saved.')
    }
    setCollection(loadCollection())
    setMeta(loadCardMeta())
    const nextStats = recordPacks(stats, packs)
    saveStats(nextStats)
    setStats(nextStats)
    recordSession(forSet.code, sessionName ?? forSet.name, packs[0]?.productType ?? 'play', packs)
    setSessions(loadSessions())
    const fresh = checkAchievements(nextStats)
    if (fresh.length) {
      setUnlocked(loadUnlocked())
      setToasts((t) => [...t, ...fresh])
    }
    return nextStats
  }

  const openProduct = async () => {
    if (!set || busy) return
    setBusy(true)
    setError(null)
    try {
      if (product === 'commander') {
        await openPreconDeck(set)
        return
      }
      const pool = await fetchSetPool(set)
      const packs = generateProduct(pool, product, qty)
      commitPacks(packs, set)
      setOpening({ packs, idx: 0, setName: set.name, replay: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open packs. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const openPreconDeck = async (forSet: SetInfo) => {
    const list = await fetchPreconList()
    const related = await relatedSetCodes(forSet.code)
    const codes = new Set([forSet.code.toLowerCase(), ...related])
    const matches = list.filter((p) => codes.has(p.code.toLowerCase()))
    if (!matches.length) {
      setError(`No Commander precons exist for ${forSet.name}. Try a set with Commander decks.`)
      return
    }
    const precon = matches[Math.floor(Math.random() * matches.length)]
    const deck = await fetchPrecon(precon.fileName)
    const names = [...deck.side, ...deck.main].map((e) => e.name)
    const resolved = await resolveCards(names)
    const commanders = new Set(deck.side.map((e) => e.name))
    const cards = [...deck.side, ...deck.main].flatMap((entry) => {
      const card = resolved.get(entry.name) ?? resolved.get(entry.name.toLowerCase())
      if (!card) return []
      return Array.from({ length: entry.qty }, () => ({
        card,
        foil: commanders.has(entry.name),
        sheet: 'any' as const,
      }))
    })
    if (!cards.length) {
      setError('Could not resolve that precon list. Try again.')
      return
    }
    const pack: GeneratedPack = { setCode: forSet.code, productType: 'commander', cards }
    commitPacks([pack], forSet, `${precon.name} (precon)`)
    setOpening({ packs: [pack], idx: 0, setName: precon.name, replay: false })
  }

  /** Single Play Booster for Find Your Commander mode (records collection+stats only;
   *  the hunt records one combined session when it ends). */
  const openHuntPack = async (forSet: SetInfo): Promise<GeneratedPack> => {
    const pool = await fetchSetPool(forSet)
    const pack = generatePack(pool, 'play', PRODUCT_CONFIGS.play)
    addToCollection(pack.cards)
    setCollection(loadCollection())
    setMeta(loadCardMeta())
    const nextStats = recordPacks(stats, [pack])
    saveStats(nextStats)
    setStats(nextStats)
    const fresh = checkAchievements(nextStats)
    if (fresh.length) {
      setUnlocked(loadUnlocked())
      setToasts((t) => [...t, ...fresh])
    }
    return pack
  }

  const endHunt = (packs: GeneratedPack[], huntSets: SetInfo[]) => {
    if (!packs.length || !huntSets.length) return
    recordSession(
      huntSets[0].code,
      `Commander hunt: ${huntSets.map((s) => s.name).join(', ')}`,
      'play',
      packs
    )
    setSessions(loadSessions())
  }

  const bumpDecksBuilt = () => {
    const nextStats = { ...loadStats(), decksBuilt: loadStats().decksBuilt + 1 }
    saveStats(nextStats)
    setStats(nextStats)
    const fresh = checkAchievements(nextStats)
    if (fresh.length) {
      setUnlocked(loadUnlocked())
      setToasts((t) => [...t, ...fresh])
    }
  }

  const buildFromPool = (commander: ScryCard, pool: ScryCard[]) => {
    const identity = new Set(commander.color_identity ?? [])
    const counts = new Map<string, number>()
    for (const card of pool) {
      if (card.id === commander.id) continue
      if (!(card.color_identity ?? []).every((c) => identity.has(c))) continue
      const name = codCardName(card)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const cod: CodDeck = {
      name: `${commander.name.split(',')[0].split(' //')[0]} — Pack Pulls`,
      side: [{ name: codCardName(commander), qty: 1 }],
      main: [...counts].map(([name, cardQty]) => ({ name, qty: cardQty })),
    }
    bumpDecksBuilt()
    onOpenInBuilder(cod)
  }

  const chooseHuntCommander = (commander: ScryCard, pool: ScryCard[], generate: boolean) => {
    if (generate) {
      bumpDecksBuilt()
      onGenerateFor(commander)
    } else {
      buildFromPool(commander, pool)
    }
  }

  const replaySession = async (session: PackSession) => {
    setBusy(true)
    setError(null)
    try {
      const fetched = await resolveSession(session, meta)
      const packs: GeneratedPack[] = session.packs.map((p) => ({
        setCode: session.setCode,
        productType: session.product,
        cards: p.c.flatMap(([id, foil]) => {
          const card =
            fetched.get(id) ??
            (meta[id]
              ? ({
                  id,
                  oracle_id: id,
                  name: meta[id].n,
                  cmc: 0,
                  type_line: meta[id].t,
                  color_identity: meta[id].c.split(''),
                  rarity: meta[id].r,
                  set: meta[id].s,
                  prices: { usd: null },
                  legalities: {},
                  image_uris: meta[id].i ? { small: meta[id].i, normal: meta[id].i } : undefined,
                } as ScryCard)
              : null)
          return card ? [{ card, foil: foil === 1, sheet: 'any' as const }] : []
        }),
      }))
      setOpening({ packs, idx: 0, setName: `${session.setName} (replay)`, replay: true })
      setTab('open')
    } catch {
      setError('Could not replay that session.')
    } finally {
      setBusy(false)
    }
  }

  const handleResetCollection = () => {
    if (!window.confirm('Reset your opened-card collection? Sessions and stats are kept.')) return
    resetCollection()
    setCollection(loadCollection())
    setMeta(loadCardMeta())
  }

  const handleDeleteSession = (id: string) => setSessions(deleteSession(id))

  const openingPool = (): ScryCard[] => (opening ? opening.packs.flatMap((p) => p.cards.map((c) => c.card)) : [])

  const currentPack = opening ? opening.packs[opening.idx] : null

  return (
    <div className="pack-simulator">
      <nav className="pack-tabs">
        {(
          [
            ['open', 'Open Packs'],
            ['find', 'Find Your Commander'],
            ['collection', 'Collection'],
            ['stats', 'Stats'],
            ['history', 'History'],
            ['achievements', 'Achievements'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'open' && !opening && (
        <div className="pack-setup">
          <h2>Open Some Packs</h2>
          {setsError && <p className="pack-error">{setsError}</p>}
          <div className="pack-products">
            {PRODUCTS.map((p) => (
              <button
                key={p.type}
                type="button"
                className={`pack-product-btn${product === p.type ? ' active' : ''}`}
                onClick={() => setProduct(p.type)}
              >
                <strong>{p.label}</strong>
                <small>{p.desc}</small>
              </button>
            ))}
          </div>
          <div className="pack-setup-row">
            <SetPicker sets={sets} selected={set} onSelect={setSet} disabled={busy} />
            {(product === 'play' || product === 'collector' || product === 'jumpstart') && (
              <select value={qty} onChange={(e) => setQty(Number(e.target.value))} disabled={busy}>
                <option value={1}>1 pack</option>
                <option value={3}>3 packs</option>
                <option value={6}>6 packs (Sealed)</option>
              </select>
            )}
            {PRODUCT_CONFIGS[product as keyof typeof PRODUCT_CONFIGS]?.approximate && (
              <span className="approx-badge" title="This product's collation is an approximation">
                approximate collation
              </span>
            )}
          </div>
          {error && <p className="pack-error">{error}</p>}
          <button
            type="button"
            className="open-pack-btn"
            disabled={!set || busy}
            onClick={() => void openProduct()}
          >
            {busy
              ? 'Opening…'
              : product === 'box'
                ? 'Open Booster Box'
                : product === 'bundle'
                  ? 'Open Bundle'
                  : product === 'commander'
                    ? 'Open Commander Deck'
                    : qty === 1
                      ? 'Open Pack'
                      : `Open ${qty} Packs${qty === 6 ? ' (Sealed)' : ''}`}
          </button>
        </div>
      )}

      {tab === 'open' && opening && currentPack && (
        <div className="pack-opening">
          <div className="pack-opening-head">
            <h2>{opening.setName}</h2>
            <button
              type="button"
              className="new-build"
              onClick={() => setOpening(null)}
            >
              ← Back
            </button>
          </div>
          <PackReveal
            key={`${opening.setName}-${opening.idx}`}
            cards={currentPack.cards}
            packNumber={opening.idx + 1}
            packCount={opening.packs.length}
            onNext={
              opening.idx < opening.packs.length - 1
                ? () => setOpening({ ...opening, idx: opening.idx + 1 })
                : undefined
            }
            onDone={() => setOpening(null)}
            onBuildDeck={opening.replay ? undefined : (commander) => buildFromPool(commander, openingPool())}
            autoFlip={opening.replay}
            disablePreviews={disableCardPreviews}
          />
        </div>
      )}

      {tab === 'find' && (
        <FindCommander
          sets={sets}
          openPack={openHuntPack}
          onChoose={chooseHuntCommander}
          onEndHunt={endHunt}
          disablePreviews={disableCardPreviews}
        />
      )}

      {tab === 'collection' && (
        <PackCollection collection={collection} meta={meta} sets={sets} onReset={handleResetCollection} />
      )}

      {tab === 'stats' && <PackStatsDash stats={stats} sets={sets} />}

      {tab === 'history' && (
        <PackHistory
          sessions={sessions}
          meta={meta}
          onReplay={(s) => void replaySession(s)}
          onDelete={handleDeleteSession}
        />
      )}

      {tab === 'achievements' && <PackAchievements unlocked={unlocked} stats={stats} />}

      {toasts.length > 0 && (
        <div className="achievement-toast">
          <span className="achievement-icon">{toasts[0].icon}</span>
          <div>
            <strong>Achievement unlocked!</strong>
            <small>
              {toasts[0].name} — {toasts[0].desc}
            </small>
          </div>
        </div>
      )}
    </div>
  )
}
