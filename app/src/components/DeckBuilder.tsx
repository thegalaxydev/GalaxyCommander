import { useEffect, useMemo, useRef, useState } from 'react'
import type { Category, DeckCard, ScryCard } from '../types'
import { CATEGORY_ORDER } from '../types'
import { categorize, deckFromCards } from '../generator'
import { cardImage, cardPrice } from '../scryfall'
import { deckHealth, estimateBracketFromCards } from '../analysis'
import { resolveCards } from '../edhrec'
import {
  deckToCod,
  parseCod,
  parseText,
  downloadCod,
  downloadCodText,
  loadSavedDecks,
  upsertSavedDeck,
  deleteSavedDeck,
  codCardName,
  codPrinting,
  type CodDeck,
  type CodEntry,
  type SavedDeck,
} from '../cod'
import { detectDeckUrl, importDeckFromUrl } from '../deckImport'
import { fetchPreconList, fetchPrecon, type PreconSummary } from '../mtgjson'
import { buildShareUrl, createPermalink } from '../share'
import { CardPicker } from './CardPicker'
import { PrintingPicker } from './PrintingPicker'
import { fetchPinnedPrintings, pinKey, printingLabel, toPreferredPrintings } from '../printings'
import { StatsPanel } from './StatsPanel'
import { ManaCost } from './ManaCost'
import { SvgIcon } from './Icons'
import { CATEGORY_ICONS } from '../iconData'

interface Entry {
  name: string
  qty: number
  card: ScryCard | null
  /** Printing named by the imported list, kept for cards Scryfall couldn't resolve. */
  set?: string
  collectorNumber?: string
}

interface Hover {
  src: string
  x: number
  y: number
}

interface Props {
  onAnalyze: (commander: ScryCard, partner: ScryCard | null, cards: DeckCard[], name: string) => void
  onImprove: (commander: ScryCard, partner: ScryCard | null, cards: ScryCard[]) => void
  initialDeck?: CodDeck | null
  /** Set codes from the generator sidebar, highest priority first. */
  preferredSets?: string[]
  /** Write set / collector number into exported files. */
  exportPrintings?: boolean
}

export function DeckBuilder({
  onAnalyze,
  onImprove,
  initialDeck,
  preferredSets = [],
  exportPrintings = true,
}: Props) {
  const [saved, setSaved] = useState<SavedDeck[]>(loadSavedDecks)
  const [deckId, setDeckId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [side, setSide] = useState<Entry[]>([])
  const [main, setMain] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [hover, setHover] = useState<Hover | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [preconOpen, setPreconOpen] = useState(false)
  const [precons, setPrecons] = useState<PreconSummary[]>([])
  const [preconQuery, setPreconQuery] = useState('')
  const [preconError, setPreconError] = useState<string | null>(null)
  const [shared, setShared] = useState(false)
  const [permaBusy, setPermaBusy] = useState(false)
  const [permaFlash, setPermaFlash] = useState(false)
  const [artFor, setArtFor] = useState<{ zone: 'side' | 'main'; entry: Entry } | null>(null)
  const [applyingSets, setApplyingSets] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastLoadedDeck = useRef<CodDeck | null>(null)

  useEffect(() => {
    const refresh = () => setSaved(loadSavedDecks())
    window.addEventListener('gc-user-data-changed', refresh)
    return () => window.removeEventListener('gc-user-data-changed', refresh)
  }, [])

  const showHover = (card: ScryCard | null, e: React.MouseEvent) => {
    const src = card ? cardImage(card, 'normal') : ''
    if (src) {
      const previewW = 250
      const previewH = 350
      const x = Math.min(e.clientX + 20, window.innerWidth - previewW - 12)
      const y = Math.min(Math.max(e.clientY - 40, 12), window.innerHeight - previewH - 12)
      setHover({ src, x, y })
    } else setHover(null)
  }

  const total = [...side, ...main].reduce((n, e) => n + e.qty, 0)

  const statsCards: DeckCard[] = useMemo(
    () => [
      ...side
        .filter((e) => e.card)
        .map((e) => ({ card: e.card!, qty: e.qty, category: 'Commander' as Category, reason: '' })),
      ...main
        .filter((e) => e.card)
        .map((e) => ({ card: e.card!, qty: e.qty, category: categorize(e.card!), reason: '' })),
    ],
    [side, main]
  )

  const toEntry = (e: Entry): CodEntry => ({
    name: e.card ? codCardName(e.card) : e.name,
    qty: e.qty,
    // Unresolved cards keep whatever printing the import named.
    ...(e.card ? codPrinting(e.card) : { set: e.set, collectorNumber: e.collectorNumber }),
  })

  const toCodDeck = (): CodDeck => ({
    name: name.trim() || 'Untitled Deck',
    side: side.map(toEntry),
    main: main.map(toEntry),
  })

  const codOptions = { includePrintings: exportPrintings }

  const commanderCard = side.find((e) => e.card)?.card ?? null
  const partnerCard = side.filter((e) => e.card)[1]?.card ?? null

  const analyze = () => {
    if (!commanderCard) {
      window.alert(
        'Set a commander first — use the ★ button on a card to move it into the Commander zone.'
      )
      return
    }
    const cards: DeckCard[] = main
      .filter((e) => e.card)
      .map((e) => ({ card: e.card!, category: categorize(e.card!), qty: e.qty, reason: '' }))
    if (cards.length === 0) {
      window.alert('Add some cards to the deck before analyzing.')
      return
    }
    onAnalyze(commanderCard, partnerCard, cards, name.trim() || 'Untitled Deck')
  }

  const improve = () => {
    if (!commanderCard) {
      window.alert(
        'Set a commander first — use the ★ button on a card to move it into the Commander zone.'
      )
      return
    }
    const isBasic = (n: string) => /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(n)
    const cards = main
      .filter((e) => e.card && !isBasic(e.card.name))
      .map((e) => e.card!)
    onImprove(commanderCard, partnerCard, cards)
  }

  const exportDeck = async (deckName: string, xml: string) => {
    try {
      await downloadCod(deckName, xml)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      window.alert(message)
    }
  }

  const exportDeckText = async (deckName: string, cod: CodDeck) => {
    try {
      await downloadCodText(deckName, cod, codOptions)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      window.alert(message)
    }
  }

  const loadCodDeck = async (cod: CodDeck) => {
    setBusy(true)
    try {
      const entries = [...cod.side, ...cod.main]
      const [resolved, pinned] = await Promise.all([
        resolveCards(entries.map((e) => e.name)),
        // Entries that name a printing get that exact art back; the rest fall
        // through to Scryfall's default printing for the card.
        fetchPinnedPrintings(entries.filter((e) => e.set)).catch(
          () => new Map<string, ScryCard>()
        ),
      ])
      const lookup = new Map<string, ScryCard>()
      for (const card of resolved.values()) {
        lookup.set(card.name.toLowerCase(), card)
        lookup.set(card.name.split(' // ')[0].toLowerCase(), card)
        for (const face of card.card_faces ?? []) {
          if (face?.name) lookup.set(face.name.toLowerCase(), card)
        }
      }
      const mk = (e: CodEntry): Entry => {
        const key = e.name.toLowerCase()
        const card =
          (e.set ? pinned.get(pinKey(e)) : undefined) ??
          resolved.get(e.name) ??
          resolved.get(key) ??
          lookup.get(key) ??
          lookup.get(e.name.split(' // ')[0].toLowerCase()) ??
          null
        return { ...e, card }
      }
      setName(cod.name)
      setSide(cod.side.map(mk))
      setMain(cod.main.map(mk))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!initialDeck || lastLoadedDeck.current === initialDeck) return
    lastLoadedDeck.current = initialDeck
    setDeckId(null)
    void loadCodDeck(initialDeck)
  }, [initialDeck])

  const shareCurrent = async () => {
    const url = buildShareUrl(toCodDeck())
    if (url.length > 8000) {
      window.alert('This deck is too large to share as a link. Export it as .txt or .cod instead.')
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setShared(true)
      setTimeout(() => setShared(false), 1500)
    } catch {
      window.prompt('Copy this shareable link:', url)
    }
  }

  const permalinkCurrent = async () => {
    if (permaBusy) return
    setPermaBusy(true)
    try {
      const url = await createPermalink(toCodDeck())
      try {
        await navigator.clipboard.writeText(url)
        setPermaFlash(true)
        setTimeout(() => setPermaFlash(false), 1500)
      } catch {
        window.prompt('Copy this permanent link:', url)
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not create a permanent link.')
    } finally {
      setPermaBusy(false)
    }
  }

  const newDeck = () => {
    setDeckId(null)
    setName('')
    setSide([])
    setMain([])
  }

  const saveCurrent = () => {
    const entry = upsertSavedDeck({
      id: deckId ?? undefined,
      name: name.trim() || 'Untitled Deck',
      cod: toCodDeck(),
      commander: commanderCard ? codCardName(commanderCard) : undefined,
      colorIdentity: commanderCard?.color_identity,
    })
    setDeckId(entry.id)
    setSaved(loadSavedDecks())
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
  }

  const importFile = async (file: File) => {
    const text = await file.text()
    const isCod = /\.(cod|xml)$/i.test(file.name) || /^\s*<\?xml|<cockatrice_deck/i.test(text)
    const cod = isCod ? parseCod(text) : parseText(text)
    setDeckId(null)
    if (!cod.name || cod.name === 'Imported Deck') cod.name = file.name.replace(/\.[^.]+$/i, '')
    await loadCodDeck(cod)
  }

  const importFromText = async () => {
    const value = importText.trim()
    if (!value) return
    setImportError(null)
    setBusy(true)
    try {
      const cod = detectDeckUrl(value) ? await importDeckFromUrl(value) : parseText(value)
      if (!cod.main.length && !cod.side.length) {
        throw new Error('Could not find any cards to import.')
      }
      setDeckId(null)
      await loadCodDeck(cod)
      setImportText('')
      setImportOpen(false)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  const togglePrecons = async () => {
    setPreconError(null)
    const next = !preconOpen
    setPreconOpen(next)
    if (next && precons.length === 0) {
      try {
        setPrecons(await fetchPreconList())
      } catch (err) {
        setPreconError(err instanceof Error ? err.message : 'Could not load precons.')
      }
    }
  }

  const loadPrecon = async (p: PreconSummary) => {
    setPreconError(null)
    setBusy(true)
    try {
      const cod = await fetchPrecon(p.fileName)
      if (!cod.main.length) throw new Error('That precon had no cards to load.')
      setDeckId(null)
      await loadCodDeck(cod)
      setPreconOpen(false)
      setPreconQuery('')
    } catch (err) {
      setPreconError(err instanceof Error ? err.message : 'Could not load that precon.')
    } finally {
      setBusy(false)
    }
  }

  const setPrinting = (zone: 'side' | 'main', entryName: string, printing: ScryCard) =>
    updateList(zone, (list) =>
      list.map((e) =>
        e.name === entryName
          ? { ...e, card: printing, set: undefined, collectorNumber: undefined }
          : e
      )
    )

  // Re-prints the whole deck from the preferred-set list configured on the
  // Generate tab. Cards with no printing in any of those sets are left alone.
  const applyPreferredSets = async () => {
    if (!preferredSets.length || applyingSets) return
    setApplyingSets(true)
    try {
      const cards = [...side, ...main].map((e) => e.card).filter((c): c is ScryCard => !!c)
      const swaps = await toPreferredPrintings(cards, preferredSets)
      if (!swaps.size) {
        window.alert('No cards in this deck have a printing in those sets.')
        return
      }
      const swap = (list: Entry[]) =>
        list.map((e) => {
          const next = e.card ? swaps.get(e.card.name) : undefined
          return next && next.id !== e.card?.id
            ? { ...e, card: next, set: undefined, collectorNumber: undefined }
            : e
        })
      setSide(swap)
      setMain(swap)
    } catch {
      window.alert('Could not reach Scryfall to look up those printings.')
    } finally {
      setApplyingSets(false)
    }
  }

  const addCard = (card: ScryCard) => {
    setMain((m) => [...m, { name: card.name, qty: 1, card }])
  }

  const updateList = (zone: 'side' | 'main', fn: (list: Entry[]) => Entry[]) => {
    if (zone === 'side') setSide(fn)
    else setMain(fn)
  }

  const changeQty = (zone: 'side' | 'main', entryName: string, delta: number) =>
    updateList(zone, (list) =>
      list
        .map((e) => (e.name === entryName ? { ...e, qty: e.qty + delta } : e))
        .filter((e) => e.qty > 0)
    )

  const removeEntry = (zone: 'side' | 'main', entryName: string) =>
    updateList(zone, (list) => list.filter((e) => e.name !== entryName))

  const moveEntry = (from: 'side' | 'main', entryName: string) => {
    const list = from === 'side' ? side : main
    const entry = list.find((e) => e.name === entryName)
    if (!entry) return
    if (from === 'side') {
      setSide(side.filter((e) => e.name !== entryName))
      setMain([...main, entry])
    } else {
      setMain(main.filter((e) => e.name !== entryName))
      setSide([...side, entry])
    }
  }

  const gcEntries = main.filter((e) => e.card?.game_changer)
  const gcNames = new Set(gcEntries.map((e) => e.name))
  const mainGroups = CATEGORY_ORDER.filter((c) => c !== 'Commander')
    .map((cat) => ({
      cat: cat as string,
      entries: main.filter(
        (e) => e.card && categorize(e.card) === cat && !gcNames.has(e.name)
      ),
    }))
    .filter((g) => g.entries.length)
  const unknown = main.filter((e) => !e.card)
  if (unknown.length) mainGroups.push({ cat: 'Unrecognized', entries: unknown })
  if (gcEntries.length) mainGroups.unshift({ cat: 'Game Changers', entries: gcEntries })

  return (
    <div className="app builder-view">
      <aside className="sidebar">
        <h2>Saved Decks</h2>
        <div className="builder-actions">
          <button className="theme-row add" onClick={newDeck}>
            + New Deck
          </button>
          <button className="theme-row add" onClick={() => fileRef.current?.click()}>
            ⬆ Import file (.cod / .txt)
          </button>
          <button
            className="theme-row add"
            onClick={() => {
              setImportError(null)
              setImportOpen((v) => !v)
            }}
          >
            🔗 Import from URL / text
          </button>
          <button className="theme-row add" onClick={togglePrecons}>
            🃏 Load an official precon
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".cod,.xml,.txt,.dec"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) importFile(file)
              e.target.value = ''
            }}
          />
          {importOpen && (
            <div className="import-box">
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={'Paste a Moxfield or Archidekt deck link,\nor a full decklist (1 Sol Ring ...).'}
                rows={5}
              />
              {importError && <p className="import-error">{importError}</p>}
              <button
                className="theme-row add"
                disabled={busy || !importText.trim()}
                onClick={importFromText}
              >
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          )}
          {preconOpen && (
            <div className="import-box precon-box">
              <input
                className="deck-name-input"
                value={preconQuery}
                onChange={(e) => setPreconQuery(e.target.value)}
                placeholder="Search precons (e.g. Sliver, Vampire, 2024)..."
              />
              {preconError && <p className="import-error">{preconError}</p>}
              {!preconError && precons.length === 0 && <p className="hint">Loading precons…</p>}
              <div className="precon-list">
                {precons
                  .filter((p) => {
                    const q = preconQuery.trim().toLowerCase()
                    return !q || p.name.toLowerCase().includes(q) || p.releaseDate.includes(q)
                  })
                  .slice(0, 80)
                  .map((p) => (
                    <button
                      key={p.fileName}
                      className="precon-row"
                      disabled={busy}
                      onClick={() => void loadPrecon(p)}
                    >
                      <strong>{p.name}</strong>
                      <small>
                        {p.code} · {p.releaseDate}
                      </small>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
        <div className="saved-list">
          {saved.length === 0 && <p className="hint">No saved decks yet. Build one here or save a generated deck.</p>}
          {saved.map((d) => (
            <div key={d.id} className={`saved-deck ${d.id === deckId ? 'active' : ''}`}>
              <button
                className="saved-load"
                onClick={() => {
                  setDeckId(d.id)
                  loadCodDeck(parseCod(d.cod))
                }}
              >
                <strong>{d.name}</strong>
                <small>
                  {d.cards} cards · {new Date(d.updated).toLocaleDateString()}
                </small>
              </button>
              <div className="saved-buttons">
                <button
                  type="button"
                  title="Export .cod"
                  onClick={() =>
                    void exportDeck(
                      d.name,
                      exportPrintings ? d.cod : deckToCod(parseCod(d.cod), codOptions)
                    )
                  }
                >
                  ⬇
                </button>
                <button title="Delete" onClick={() => setSaved(deleteSavedDeck(d.id))}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="center builder-center">
        <div className="builder-toolbar">
          <input
            className="deck-name-input"
            placeholder="Deck name..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <span className="builder-count">{total} cards</span>
          <button className="new-build" onClick={saveCurrent}>
            {savedFlash ? '✓ Saved' : 'Save'}
          </button>
          <button
            type="button"
            className="new-build"
            onClick={analyze}
            disabled={total === 0}
            title="Open the full analysis view (overview, decklist, combos, playtest, upgrades)"
          >
            📊 Analyze
          </button>
          <button
            type="button"
            className="new-build"
            onClick={improve}
            disabled={total === 0}
            title="Open the generator with this commander and your cards pinned — tune bracket/budget/themes, unpin any cards you want swapped, then Generate"
          >
            ✨ Improve
          </button>
          <button
            type="button"
            className="new-build"
            onClick={() => void exportDeck(name.trim() || 'deck', deckToCod(toCodDeck(), codOptions))}
            disabled={total === 0}
          >
            ⬇ Export .cod
          </button>
          <button
            type="button"
            className="new-build"
            onClick={() => void exportDeckText(name.trim() || 'deck', toCodDeck())}
            disabled={total === 0}
          >
            ⬇ Export .txt
          </button>
          {preferredSets.length > 0 && (
            <button
              type="button"
              className="new-build"
              onClick={() => void applyPreferredSets()}
              disabled={total === 0 || applyingSets}
              title={`Re-print every card from the first of these sets that has it: ${preferredSets.join(', ')}`}
            >
              {applyingSets ? 'Applying…' : `🎨 Apply sets (${preferredSets.join(', ')})`}
            </button>
          )}
          <button
            type="button"
            className="new-build"
            onClick={() => void shareCurrent()}
            disabled={total === 0}
            title="Copy a shareable link that reconstructs this deck — no account or upload needed"
          >
            {shared ? '✓ Link copied' : '🔗 Share link'}
          </button>
          <button
            type="button"
            className="new-build"
            onClick={() => void permalinkCurrent()}
            disabled={total === 0 || permaBusy}
            title="Save a short permanent link (e.g. /d/abc123). Stored for 90 days, refreshed whenever it's opened"
          >
            {permaFlash ? '✓ Permalink copied' : permaBusy ? 'Saving…' : '♾ Permalink'}
          </button>
        </div>

        <div className="builder-search">
          <CardPicker
            placeholder="Search a card name, or Scryfall syntax like t:goblin mv<=3..."
            exclude={[...side, ...main].map((e) => e.name)}
            onPick={addCard}
          />
          <p className="hint">
            Type a name, or use{' '}
            <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noreferrer">
              Scryfall syntax
            </a>{' '}
            to search by anything else — types <code>t:</code>, text <code>o:</code>{' '}
            <code>kw:</code>, colors <code>c:</code> <code>id:</code>, mana <code>m:</code>{' '}
            <code>mv:</code>, stats <code>pow:</code> <code>tou:</code>, printing{' '}
            <code>r:</code> <code>e:</code> <code>year:</code>, price <code>usd:</code>, plus{' '}
            <code>is:</code> / <code>not:</code>, <code>-</code> to exclude and{' '}
            <code>!</code> for an exact name.
          </p>
        </div>

        {busy ? (
          <p className="hint pad">Resolving cards from Scryfall...</p>
        ) : (
          <div className="builder-lists">
            <section className="deck-group">
              <h3>
                <SvgIcon name={CATEGORY_ICONS['Commander']} size={13} /> Commander (
                {side.reduce((n, e) => n + e.qty, 0)})
              </h3>
              {side.length === 0 && (
                <p className="hint">Use the ★ button on a card below to set it as your commander.</p>
              )}
              {side.map((e) => (
                <BuilderRow
                  key={e.name}
                  entry={e}
                  zone="side"
                  onQty={changeQty}
                  onRemove={removeEntry}
                  onMove={moveEntry}
                  onHover={showHover}
                  onLeave={() => setHover(null)}
                  onArt={(entry) => setArtFor({ zone: 'side', entry })}
                />
              ))}
            </section>
            {main.length === 0 && side.length === 0 && (
              <p className="hint pad">
                Search above to start adding cards, import a .cod file, or save a generated deck
                from the Generate tab.
              </p>
            )}
            <div className="decklist-cols">
              {mainGroups.map((g) => (
                <section
                  key={g.cat}
                  className={`deck-group ${g.cat === 'Game Changers' ? 'game-changers' : ''}`}
                >
                  <h3>
                    {g.cat === 'Game Changers' ? (
                      '⚡ '
                    ) : CATEGORY_ICONS[g.cat as Category] ? (
                      <>
                        <SvgIcon name={CATEGORY_ICONS[g.cat as Category]} size={13} />{' '}
                      </>
                    ) : null}
                    {g.cat} ({g.entries.reduce((n, e) => n + e.qty, 0)})
                  </h3>
                  {g.entries.map((e) => (
                    <BuilderRow
                      key={e.name}
                      entry={e}
                      zone="main"
                      onQty={changeQty}
                      onRemove={removeEntry}
                      onMove={moveEntry}
                      onHover={showHover}
                      onLeave={() => setHover(null)}
                      onArt={(entry) => setArtFor({ zone: 'main', entry })}
                    />
                  ))}
                </section>
              ))}
            </div>
          </div>
        )}
      </main>

      <aside className="right">
        <StatsPanel cards={statsCards} />
        {main.some((e) => e.card) && <BuilderBracket cards={statsCards} />}
        {commanderCard && main.some((e) => e.card) && (
          <BuilderHealth commander={commanderCard} partner={partnerCard} cards={statsCards} />
        )}
      </aside>

      {hover && (
        <img
          className="card-preview"
          src={hover.src}
          style={{ top: hover.y, left: hover.x }}
          alt=""
        />
      )}

      {artFor?.entry.card && (
        <PrintingPicker
          key={artFor.entry.card.id}
          card={artFor.entry.card}
          onClose={() => setArtFor(null)}
          onPick={(printing) => {
            setPrinting(artFor.zone, artFor.entry.name, printing)
            setArtFor(null)
          }}
        />
      )}
    </div>
  )
}

function BuilderBracket({ cards }: { cards: DeckCard[] }) {
  const est = useMemo(() => estimateBracketFromCards(cards), [cards])
  return (
    <div className="deck-health builder-health">
      <div className="perceived-bracket compact">
        <span className={`pb-badge b${est.bracket}`}>
          Likely Bracket {est.bracket} · {est.label}
        </span>
        <span className="pb-reasons">{est.reasons.join(' · ')}</span>
      </div>
    </div>
  )
}

function BuilderHealth({
  commander,
  partner,
  cards,
}: {
  commander: ScryCard
  partner: ScryCard | null
  cards: DeckCard[]
}) {
  const deck = useMemo(
    () => deckFromCards(commander, partner, cards),
    [commander, partner, cards]
  )
  const health = deckHealth(deck)
  const warnings = health.filter((h) => h.level === 'warn')
  return (
    <div className="deck-health builder-health">
      <h3>
        Deck Health{' '}
        <span className={`health-badge ${warnings.length ? 'warn' : 'ok'}`}>
          {warnings.length
            ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}`
            : 'All clear'}
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
  )
}

function BuilderRow({
  entry,
  zone,
  onQty,
  onRemove,
  onMove,
  onHover,
  onLeave,
  onArt,
}: {
  entry: Entry
  zone: 'side' | 'main'
  onQty: (zone: 'side' | 'main', name: string, delta: number) => void
  onRemove: (zone: 'side' | 'main', name: string) => void
  onMove: (from: 'side' | 'main', name: string) => void
  onHover: (card: ScryCard | null, e: React.MouseEvent) => void
  onLeave: () => void
  onArt: (entry: Entry) => void
}) {
  const card = entry.card
  return (
    <div className="deck-row builder-row">
      <span className="deck-qty">{entry.qty}</span>
      <span className="deck-name">
        <span
          className="deck-name-text"
          onMouseEnter={(e) => onHover(card, e)}
          onMouseMove={(e) => onHover(card, e)}
          onMouseLeave={onLeave}
        >
          {entry.name.split(' //')[0]}
          {card?.game_changer && (
            <span className="gc-badge" title="On the Commander Game Changers list">
              GC
            </span>
          )}
        </span>
      </span>
      {card && <ManaCost cost={card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? ''} />}
      {card && (
        <span className="deck-price">
          {cardPrice(card) > 0 ? `$${cardPrice(card).toFixed(2)}` : ''}
        </span>
      )}
      <span className="row-buttons">
        {card && (
          <button
            className="art-btn"
            title={`Choose printing — currently ${printingLabel(card) || 'default'}`}
            onClick={() => onArt(entry)}
          >
            🎨
          </button>
        )}
        <button title="Remove one" onClick={() => onQty(zone, entry.name, -1)}>
          −
        </button>
        <button title="Add one" onClick={() => onQty(zone, entry.name, 1)}>
          +
        </button>
        <button
          title={zone === 'main' ? 'Set as commander' : 'Move to main deck'}
          onClick={() => onMove(zone, entry.name)}
        >
          {zone === 'main' ? '★' : '↓'}
        </button>
        <button title="Remove" onClick={() => onRemove(zone, entry.name)}>
          ×
        </button>
      </span>
    </div>
  )
}
