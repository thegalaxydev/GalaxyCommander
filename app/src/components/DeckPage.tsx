import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  deleteComment,
  fetchComments,
  fetchDeckDetail,
  likeDeck,
  postComment,
  recordDeckView,
  unlikeDeck,
  type DeckComment,
  type DeckDetail,
} from '../auth/social'
import { parseCod, type CodEntry } from '../cod'
import { cardImageByName, fetchNamedCard } from '../scryfall'
import { navigateToUserProfile, navigateToView } from '../route'
import { ColorPips } from './ManaCost'
import { ShareIcon } from './ShareIcon'

function relTime(ts: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

interface Props {
  username: string
  deckId: string
  onAuthRequired: () => void
}

export function DeckPage({ username, deckId, onAuthRequired }: Props) {
  const { user } = useAuth()
  const [deck, setDeck] = useState<DeckDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [viewCount, setViewCount] = useState(0)
  const [comments, setComments] = useState<DeckComment[]>([])
  const [commentText, setCommentText] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [shared, setShared] = useState(false)
  const [hover, setHover] = useState<{ src: string; x: number; y: number } | null>(null)
  const viewedRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setBanner(null)
    void (async () => {
      try {
        const data = await fetchDeckDetail(username, deckId)
        if (cancelled) return
        if (!data) {
          setError('This deck is private or no longer exists.')
          setLoading(false)
          return
        }
        setDeck(data)
        setLiked(data.viewerLiked)
        setLikeCount(data.likeCount)
        setViewCount(data.viewCount)
        void fetchComments(username, deckId).then((c) => !cancelled && setComments(c)).catch(() => {})
        // Count a view once per mounted deck.
        if (viewedRef.current !== deckId) {
          viewedRef.current = deckId
          void recordDeckView(username, deckId).then((n) => !cancelled && n && setViewCount(n))
        }
        // Resolve commander art for the banner.
        if (data.commander) {
          void fetchNamedCard(data.commander).then((card) => {
            if (cancelled || !card) return
            const art = card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop
            if (art) setBanner(art)
          })
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load deck')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [username, deckId])

  const toggleLike = async () => {
    if (!user) {
      onAuthRequired()
      return
    }
    const next = !liked
    setLiked(next)
    setLikeCount((c) => c + (next ? 1 : -1))
    try {
      const res = next ? await likeDeck(username, deckId) : await unlikeDeck(username, deckId)
      setLiked(res.liked)
      setLikeCount(res.likeCount)
    } catch {
      setLiked(!next)
      setLikeCount((c) => c + (next ? -1 : 1))
    }
  }

  const submitComment = async () => {
    if (!user) {
      onAuthRequired()
      return
    }
    const text = commentText.trim()
    if (!text) return
    setCommentBusy(true)
    setCommentError(null)
    try {
      const created = await postComment(username, deckId, text)
      setComments((prev) => [created, ...prev])
      setCommentText('')
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'Could not post comment')
    } finally {
      setCommentBusy(false)
    }
  }

  const removeComment = async (id: string) => {
    const prev = comments
    setComments((c) => c.filter((x) => x.id !== id))
    try {
      await deleteComment(username, deckId, id)
    } catch {
      setComments(prev)
    }
  }

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShared(true)
      window.setTimeout(() => setShared(false), 1500)
    } catch {
      window.prompt('Copy this deck link:', window.location.href)
    }
  }

  const moveHover = (name: string, e: React.MouseEvent) => {
    const src = cardImageByName(name, 'normal')
    const x = Math.min(e.clientX + 18, window.innerWidth - 260)
    const y = Math.min(Math.max(e.clientY - 170, 8), window.innerHeight - 360)
    setHover({ src, x, y })
  }

  const cod = deck?.cod ? parseCod(deck.cod) : null
  const commanders = cod?.side ?? []
  const mainCards = (cod?.main ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
  const canModerate = (c: DeckComment) =>
    !!user && (c.authorId === user.id || (deck?.owner.username && user.username === deck.owner.username))

  const cardRow = (entry: CodEntry) => (
    <li
      key={entry.name}
      className="deck-page-card"
      onMouseEnter={(e) => moveHover(entry.name, e)}
      onMouseMove={(e) => moveHover(entry.name, e)}
      onMouseLeave={() => setHover(null)}
    >
      <span className="deck-page-qty">{entry.qty}</span>
      <span className="deck-page-cardname">{entry.name}</span>
    </li>
  )

  return (
    <div className="profile-page deck-page">
      <header className="topnav profile-topnav">
        <h1 className="logo">
          <button type="button" className="link-btn logo-link" onClick={() => navigateToView('generate')}>
            <img src="/icon.png" alt="" /> Galaxy Commander
          </button>
        </h1>
      </header>

      <main className="profile-main">
        {loading && <p className="hint profile-status">Loading deck…</p>}
        {!loading && error && <p className="auth-error profile-status">{error}</p>}
        {!loading && deck && (
          <>
            <section
              className="deck-page-banner"
              style={banner ? { backgroundImage: `linear-gradient(180deg, rgba(10,8,20,0.25), rgba(10,8,20,0.9)), url(${banner})` } : undefined}
            >
              <div className="deck-page-banner-inner">
                <h2>{deck.name}</h2>
                <div className="deck-page-sub">
                  {deck.colorIdentity && deck.colorIdentity.length > 0 && (
                    <ColorPips identity={deck.colorIdentity} />
                  )}
                  {deck.commander && <span className="deck-page-commander">{deck.commander}</span>}
                </div>
                <div className="deck-page-meta">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => deck.owner.username && navigateToUserProfile(deck.owner.username)}
                  >
                    {deck.owner.avatarUrl ? (
                      <img className="deck-page-owner-avatar" src={deck.owner.avatarUrl} alt="" />
                    ) : null}
                    {deck.owner.displayName}
                  </button>
                  <span>·</span>
                  <span>{deck.cards} cards</span>
                  <span>·</span>
                  <span>Updated {relTime(deck.updated)}</span>
                </div>
                <div className="deck-page-actions">
                  <button
                    type="button"
                    className={`deck-action-btn${liked ? ' liked' : ''}`}
                    onClick={() => void toggleLike()}
                    title={user ? 'Like this deck' : 'Sign in to like'}
                  >
                    {liked ? '❤' : '♡'} {likeCount}
                  </button>
                  <span className="deck-action-stat">👁 {viewCount}</span>
                  <span className="deck-action-stat">💬 {comments.length || deck.commentCount}</span>
                  <button type="button" className="deck-action-btn" onClick={() => void share()}>
                    <ShareIcon size={16} /> {shared ? 'Copied!' : 'Share'}
                  </button>
                </div>
              </div>
            </section>

            <section className="deck-page-list">
              {commanders.length > 0 && (
                <div className="deck-page-group">
                  <h3>Commander</h3>
                  <div className="deck-page-commander-card">
                    {commanders[0] && (
                      <img
                        src={cardImageByName(commanders[0].name, 'normal')}
                        alt={commanders[0].name}
                        loading="lazy"
                      />
                    )}
                    <div>
                      {commanders.map((c) => (
                        <div key={c.name} className="deck-page-commander-name">
                          {c.name}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div className="deck-page-group">
                <h3>Deck ({mainCards.reduce((n, c) => n + c.qty, 0)})</h3>
                <ul className="deck-page-cards">{mainCards.map(cardRow)}</ul>
              </div>
            </section>

            <section className="deck-comments">
              <h3>Comments ({comments.length})</h3>
              <div className="deck-comment-compose">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={user ? 'Add a comment…' : 'Sign in to comment'}
                  maxLength={2000}
                  rows={3}
                  onFocus={() => !user && onAuthRequired()}
                />
                {commentError && <p className="auth-error">{commentError}</p>}
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => void submitComment()}
                  disabled={commentBusy || !commentText.trim()}
                >
                  {commentBusy ? 'Posting…' : 'Post comment'}
                </button>
              </div>
              {comments.length === 0 ? (
                <p className="hint">No comments yet. Be the first!</p>
              ) : (
                <ul className="deck-comment-list">
                  {comments.map((c) => (
                    <li key={c.id} className="deck-comment">
                      <div className="deck-comment-avatar">
                        {c.author.avatarUrl ? (
                          <img src={c.author.avatarUrl} alt="" />
                        ) : (
                          <div className="deck-comment-avatar-fallback">
                            {(c.author.displayName[0] ?? '?').toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="deck-comment-body">
                        <div className="deck-comment-head">
                          <button
                            type="button"
                            className="link-btn deck-comment-author"
                            onClick={() => c.author.username && navigateToUserProfile(c.author.username)}
                          >
                            {c.author.displayName}
                          </button>
                          <small>{new Date(c.createdAt).toLocaleDateString()}</small>
                          {canModerate(c) && (
                            <button
                              type="button"
                              className="deck-comment-delete"
                              onClick={() => void removeComment(c.id)}
                              title="Delete comment"
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <p>{c.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
      {hover && <img className="card-preview" src={hover.src} style={{ left: hover.x, top: hover.y }} alt="" />}
    </div>
  )
}
