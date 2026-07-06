import type { CardMeta, PackSession } from '../packs/types'
import { downloadTextFile, sessionCardCount, sessionToJson, sessionToText } from '../packs/sessions'

const PRODUCT_LABELS: Record<string, string> = {
  play: 'Play Booster',
  collector: 'Collector Booster',
  jumpstart: 'Jumpstart',
  commander: 'Commander Deck',
  bundle: 'Bundle',
  box: 'Booster Box',
}

interface Props {
  sessions: PackSession[]
  meta: Record<string, CardMeta>
  onReplay: (session: PackSession) => void
  onDelete: (id: string) => void
}

export function PackHistory({ sessions, meta, onReplay, onDelete }: Props) {
  if (!sessions.length) {
    return <p className="hint">Your pack opening history will appear here.</p>
  }
  return (
    <div className="pack-history">
      {sessions.map((session) => (
        <div key={session.id} className="pack-history-row">
          <div className="pack-history-info">
            <strong>{session.setName}</strong>
            <small>
              {PRODUCT_LABELS[session.product] ?? session.product} · {session.packs.length} pack
              {session.packs.length === 1 ? '' : 's'} · {sessionCardCount(session)} cards ·{' '}
              {new Date(session.ts).toLocaleString()}
            </small>
          </div>
          <div className="pack-history-actions">
            <button type="button" className="new-build" onClick={() => onReplay(session)}>
              Replay
            </button>
            <button
              type="button"
              className="new-build"
              onClick={() =>
                downloadTextFile(
                  `packs-${session.setCode}-${session.id.slice(0, 8)}.json`,
                  sessionToJson(session, meta),
                  'application/json'
                )
              }
            >
              JSON
            </button>
            <button
              type="button"
              className="new-build"
              onClick={() =>
                downloadTextFile(
                  `packs-${session.setCode}-${session.id.slice(0, 8)}.txt`,
                  sessionToText(session, meta)
                )
              }
            >
              .txt
            </button>
            <button type="button" className="new-build danger" onClick={() => onDelete(session.id)}>
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
