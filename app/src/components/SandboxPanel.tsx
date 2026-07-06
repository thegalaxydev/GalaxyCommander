import { useReducer, useState } from 'react'
import type { Deck } from '../types'
import { cardImage } from '../scryfall'
import {
  createSandbox,
  sandboxReducer,
  ZONE_LABELS,
  type SandboxAction,
  type TableCard,
  type ZoneId,
} from '../sandbox'

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

function faceImage(tc: TableCard): { src: string; back: boolean } {
  if (tc.flipped) {
    const second =
      tc.card.card_faces?.[1]?.image_uris?.small ?? tc.card.card_faces?.[1]?.image_uris?.normal
    if (second) return { src: second, back: false }
    return { src: '', back: true }
  }
  return { src: cardImage(tc.card, 'small'), back: false }
}

interface MenuState {
  iid: string
  from: ZoneId
  card: TableCard
  x: number
  y: number
}

const MENU_DESTS: ZoneId[] = ['battlefield', 'hand', 'graveyard', 'exile', 'command', 'stack']

export function SandboxPanel({ deck }: { deck: Deck }) {
  const [state, dispatch] = useReducer(sandboxReducer, deck, createSandbox)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [preview, setPreview] = useState<{ src: string; x: number; y: number } | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const onDragStart = (e: React.DragEvent, iid: string, from: ZoneId) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ iid, from }))
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDropZone = (e: React.DragEvent, to: ZoneId, toBottom?: boolean) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('text/plain')
    if (!raw) return
    try {
      const { iid, from } = JSON.parse(raw) as { iid: string; from: ZoneId }
      dispatch({ type: 'move', iid, from, to, toBottom })
    } catch {
      /* ignore */
    }
  }

  const onDropBattlefield = (e: React.DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('text/plain')
    if (!raw) return
    try {
      const { iid, from } = JSON.parse(raw) as { iid: string; from: ZoneId }
      const rect = e.currentTarget.getBoundingClientRect()
      const x = clamp(e.clientX - rect.left - 44, 0, Math.max(0, rect.width - 92))
      const y = clamp(e.clientY - rect.top - 62, 0, Math.max(0, rect.height - 128))
      dispatch({ type: 'move', iid, from, to: 'battlefield', x, y })
    } catch {
      /* ignore */
    }
  }

  const openMenu = (e: React.MouseEvent, card: TableCard, from: ZoneId) => {
    e.preventDefault()
    setMenu({ iid: card.iid, from, card, x: e.clientX, y: e.clientY })
  }

  const showPreview = (tc: TableCard, e: React.MouseEvent) => {
    const src = cardImage(tc.card, 'normal')
    if (src) {
      const x = Math.min(e.clientX + 20, window.innerWidth - 262)
      const y = Math.min(Math.max(e.clientY - 40, 12), window.innerHeight - 362)
      setPreview({ src, x, y })
    }
  }

  const allowDrop = (e: React.DragEvent) => e.preventDefault()

  const counts = state.zones

  return (
    <div className="sandbox" onClick={() => menu && setMenu(null)}>
      <div className="sandbox-toolbar">
        <button type="button" onClick={() => dispatch({ type: 'reset', deck })}>
          ⟳ New Game
        </button>
        <button type="button" onClick={() => dispatch({ type: 'mulligan' })}>
          Mulligan
        </button>
        <button type="button" onClick={() => dispatch({ type: 'nextTurn' })}>
          ⏭ Next Turn
        </button>
        <button type="button" onClick={() => dispatch({ type: 'untapAll' })}>
          Untap All
        </button>
        <button type="button" onClick={() => dispatch({ type: 'draw', n: 1 })}>
          Draw
        </button>
        <span className="sandbox-turn">Turn {state.turn}</span>
        <span className="sandbox-life">
          <button type="button" onClick={() => dispatch({ type: 'life', delta: -1 })}>
            −
          </button>
          <strong>{state.life}</strong>
          <button type="button" onClick={() => dispatch({ type: 'life', delta: 1 })}>
            +
          </button>
        </span>
      </div>

      <div className="sandbox-body">
        <aside className="sandbox-side">
          <ZonePile
            id="command"
            cards={counts.command}
            onDragStart={onDragStart}
            onDrop={onDropZone}
            onAllow={allowDrop}
            onMenu={openMenu}
            onPreview={showPreview}
            onLeave={() => setPreview(null)}
          />
          <div
            className="zone-pile library"
            onDragOver={allowDrop}
            onDrop={(e) => onDropZone(e, 'library')}
          >
            <header>
              <span>Library</span>
              <span className="zone-count">{counts.library.length}</span>
            </header>
            <button
              type="button"
              className="library-stack"
              onClick={() => dispatch({ type: 'draw', n: 1 })}
              onContextMenu={(e) => {
                e.preventDefault()
                setLibraryOpen(true)
              }}
              title="Click to draw · right-click to view"
            >
              <span>Draw</span>
            </button>
            <div className="zone-mini-row">
              <button type="button" className="zone-mini-btn" onClick={() => setLibraryOpen(true)}>
                View
              </button>
              <button
                type="button"
                className="zone-mini-btn"
                onClick={() => dispatch({ type: 'shuffle' })}
              >
                Shuffle
              </button>
            </div>
          </div>
          <ZonePile
            id="stack"
            cards={counts.stack}
            onDragStart={onDragStart}
            onDrop={onDropZone}
            onAllow={allowDrop}
            onMenu={openMenu}
            onPreview={showPreview}
            onLeave={() => setPreview(null)}
          />
          <ZonePile
            id="graveyard"
            cards={counts.graveyard}
            onDragStart={onDragStart}
            onDrop={onDropZone}
            onAllow={allowDrop}
            onMenu={openMenu}
            onPreview={showPreview}
            onLeave={() => setPreview(null)}
          />
          <ZonePile
            id="exile"
            cards={counts.exile}
            onDragStart={onDragStart}
            onDrop={onDropZone}
            onAllow={allowDrop}
            onMenu={openMenu}
            onPreview={showPreview}
            onLeave={() => setPreview(null)}
          />
        </aside>

        <div
          className="sandbox-battlefield"
          onDragOver={allowDrop}
          onDrop={onDropBattlefield}
        >
          {counts.battlefield.length === 0 && (
            <p className="sandbox-hint">
              Drag cards here from your hand or command zone. Click a card to tap it,
              right-click for more options.
            </p>
          )}
          {counts.battlefield.map((tc) => {
            const img = faceImage(tc)
            return (
              <div
                key={tc.iid}
                className={`bf-card ${tc.tapped ? 'tapped' : ''}`}
                style={{ left: tc.x, top: tc.y }}
                draggable
                onDragStart={(e) => onDragStart(e, tc.iid, 'battlefield')}
                onClick={() => dispatch({ type: 'tap', iid: tc.iid })}
                onContextMenu={(e) => openMenu(e, tc, 'battlefield')}
                onMouseEnter={(e) => showPreview(tc, e)}
                onMouseLeave={() => setPreview(null)}
                title={tc.card.name}
              >
                {img.back ? (
                  <div className="card-back" />
                ) : (
                  <img src={img.src} alt={tc.card.name} draggable={false} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div
        className="sandbox-hand"
        onDragOver={allowDrop}
        onDrop={(e) => onDropZone(e, 'hand')}
      >
        <span className="hand-label">Hand ({counts.hand.length})</span>
        <div className="hand-cards">
          {counts.hand.map((tc) => {
            const img = faceImage(tc)
            return (
              <div
                key={tc.iid}
                className="hand-card"
                draggable
                onDragStart={(e) => onDragStart(e, tc.iid, 'hand')}
                onContextMenu={(e) => openMenu(e, tc, 'hand')}
                onMouseEnter={(e) => showPreview(tc, e)}
                onMouseLeave={() => setPreview(null)}
                title={tc.card.name}
              >
                {img.back ? <div className="card-back" /> : <img src={img.src} alt={tc.card.name} draggable={false} />}
              </div>
            )
          })}
          {counts.hand.length === 0 && <span className="sandbox-hint">Hand is empty.</span>}
        </div>
      </div>

      {libraryOpen && (
        <div className="library-viewer-backdrop" onClick={() => setLibraryOpen(false)}>
          <div className="library-viewer" onClick={(e) => e.stopPropagation()}>
            <header>
              <span>Library — {state.zones.library.length} cards (top first)</span>
              <div className="lv-actions">
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: 'shuffle' })
                  }}
                >
                  Shuffle
                </button>
                <button type="button" onClick={() => setLibraryOpen(false)}>
                  Close
                </button>
              </div>
            </header>
            <p className="hint">
              Click a card to move it to hand, or right-click for more destinations.
            </p>
            <div className="library-viewer-grid">
              {state.zones.library.map((tc) => (
                <div
                  key={tc.iid}
                  className="lv-card"
                  draggable
                  onDragStart={(e) => onDragStart(e, tc.iid, 'library')}
                  onClick={() => dispatch({ type: 'move', iid: tc.iid, from: 'library', to: 'hand' })}
                  onContextMenu={(e) => openMenu(e, tc, 'library')}
                  onMouseEnter={(e) => showPreview(tc, e)}
                  onMouseLeave={() => setPreview(null)}
                  title={tc.card.name}
                >
                  <img src={cardImage(tc.card, 'small')} alt={tc.card.name} draggable={false} />
                </div>
              ))}
              {state.zones.library.length === 0 && <p className="sandbox-hint">Library is empty.</p>}
            </div>
          </div>
        </div>
      )}

      {menu && (
        <CardMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onAction={(action) => {
            dispatch(action)
            setMenu(null)
          }}
        />
      )}

      {preview && !menu && (
        <img className="card-preview" src={preview.src} style={{ top: preview.y, left: preview.x }} alt="" />
      )}
    </div>
  )
}

function ZonePile({
  id,
  cards,
  onDragStart,
  onDrop,
  onAllow,
  onMenu,
  onPreview,
  onLeave,
}: {
  id: ZoneId
  cards: TableCard[]
  onDragStart: (e: React.DragEvent, iid: string, from: ZoneId) => void
  onDrop: (e: React.DragEvent, to: ZoneId) => void
  onAllow: (e: React.DragEvent) => void
  onMenu: (e: React.MouseEvent, card: TableCard, from: ZoneId) => void
  onPreview: (tc: TableCard, e: React.MouseEvent) => void
  onLeave: () => void
}) {
  return (
    <div className={`zone-pile ${id}`} onDragOver={onAllow} onDrop={(e) => onDrop(e, id)}>
      <header>
        <span>{ZONE_LABELS[id]}</span>
        <span className="zone-count">{cards.length}</span>
      </header>
      <div className="zone-pile-cards">
        {cards.map((tc) => {
          const img = faceImage(tc)
          return (
            <div
              key={tc.iid}
              className="pile-card"
              draggable
              onDragStart={(e) => onDragStart(e, tc.iid, id)}
              onContextMenu={(e) => onMenu(e, tc, id)}
              onMouseEnter={(e) => onPreview(tc, e)}
              onMouseLeave={onLeave}
              title={tc.card.name}
            >
              {img.back ? <div className="card-back" /> : <img src={img.src} alt={tc.card.name} draggable={false} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CardMenu({
  menu,
  onClose,
  onAction,
}: {
  menu: MenuState
  onClose: () => void
  onAction: (action: SandboxAction) => void
}) {
  const left = Math.min(menu.x, window.innerWidth - 190)
  const top = Math.min(menu.y, window.innerHeight - 320)
  const dests = MENU_DESTS.filter((d) => d !== menu.from)
  return (
    <>
      <div className="card-menu-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="card-menu" style={{ left, top }}>
        <div className="card-menu-title">{menu.card.card.name.split(' //')[0]}</div>
        {menu.from === 'battlefield' && (
          <button type="button" onClick={() => onAction({ type: 'tap', iid: menu.iid })}>
            {menu.card.tapped ? 'Untap' : 'Tap'}
          </button>
        )}
        <button type="button" onClick={() => onAction({ type: 'flip', iid: menu.iid })}>
          Flip / Transform
        </button>
        <div className="card-menu-sep" />
        {dests.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onAction({ type: 'move', iid: menu.iid, from: menu.from, to: d })}
          >
            To {ZONE_LABELS[d]}
          </button>
        ))}
        {menu.from !== 'library' && (
          <>
            <button
              type="button"
              onClick={() => onAction({ type: 'move', iid: menu.iid, from: menu.from, to: 'library' })}
            >
              To Library (top)
            </button>
            <button
              type="button"
              onClick={() =>
                onAction({ type: 'move', iid: menu.iid, from: menu.from, to: 'library', toBottom: true })
              }
            >
              To Library (bottom)
            </button>
          </>
        )}
      </div>
    </>
  )
}
