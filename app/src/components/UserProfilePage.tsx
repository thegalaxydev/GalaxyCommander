import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { fetchPublicProfile, type PublicDeck, type PublicProfile } from '../auth/profile'
import { followUser, unfollowUser } from '../auth/social'
import { isSameUsername } from '../auth/validation'
import { navigateToDeck, navigateToProfileSettings, navigateToView } from '../route'
import { cardImageByName, fetchNamedCard } from '../scryfall'
import { ColorPips } from './ManaCost'
import { ShareIcon } from './ShareIcon'
import { FollowListModal } from './FollowListModal'

type DeckViewMode = 'list' | 'images'
const VIEW_KEY = 'gc-profile-deckview'

// Cache commander art + colors across renders and profile visits.
const commanderCache = new Map<string, { art?: string; colors?: string[] }>()

function formatJoined(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function loadViewMode(): DeckViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'images' ? 'images' : 'list'
  } catch {
    return 'list'
  }
}

export function UserProfilePage({
  username,
  onAuthRequired,
}: {
  username: string
  onAuthRequired: () => void
}) {
  const { user } = useAuth()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<DeckViewMode>(loadViewMode)
  const [following, setFollowing] = useState(false)
  const [followerCount, setFollowerCount] = useState(0)
  const [followBusy, setFollowBusy] = useState(false)
  const [followModal, setFollowModal] = useState<'followers' | 'following' | null>(null)
  const [shared, setShared] = useState(false)
  const [resolved, setResolved] = useState<Record<string, { art?: string; colors?: string[] }>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSearch('')
    void (async () => {
      try {
        const data = await fetchPublicProfile(username)
        if (cancelled) return
        if (!data) {
          setProfile(null)
          setError('User not found.')
        } else {
          setProfile(data)
          setFollowing(!!data.viewerFollows)
          setFollowerCount(data.followerCount)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load profile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [username])

  // Lazily resolve commander art + colors for decks that need them.
  useEffect(() => {
    if (!profile) return
    const names = new Set<string>()
    for (const d of profile.decks) {
      if (!d.commander) continue
      const cached = commanderCache.get(d.commander)
      const needColors = !d.colorIdentity || d.colorIdentity.length === 0
      const needArt = viewMode === 'images'
      if (cached && (!needArt || cached.art)) continue
      if (needColors || needArt) names.add(d.commander)
    }
    if (!names.size) return
    let cancelled = false
    void (async () => {
      for (const name of names) {
        const card = await fetchNamedCard(name)
        const entry = {
          art: card?.image_uris?.art_crop ?? card?.card_faces?.[0]?.image_uris?.art_crop,
          colors: card?.color_identity,
        }
        commanderCache.set(name, entry)
        if (!cancelled) setResolved((prev) => ({ ...prev, [name]: entry }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profile, viewMode])

  const displayName = profile?.displayName ?? username
  const handle = profile?.username ?? username
  const isOwnProfile = !!(user?.username && isSameUsername(user.username, username))

  const setMode = (mode: DeckViewMode) => {
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_KEY, mode)
    } catch {
      /* ignore */
    }
  }

  const toggleFollow = async () => {
    if (!user) {
      onAuthRequired()
      return
    }
    setFollowBusy(true)
    const next = !following
    setFollowing(next)
    setFollowerCount((c) => c + (next ? 1 : -1))
    try {
      const res = next ? await followUser(username) : await unfollowUser(username)
      setFollowing(res.following)
      setFollowerCount(res.followerCount)
    } catch {
      setFollowing(!next)
      setFollowerCount((c) => c + (next ? -1 : 1))
    } finally {
      setFollowBusy(false)
    }
  }

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShared(true)
      window.setTimeout(() => setShared(false), 1500)
    } catch {
      window.prompt('Copy this profile link:', window.location.href)
    }
  }

  const filteredDecks = useMemo(() => {
    if (!profile) return []
    const q = search.trim().toLowerCase()
    if (!q) return profile.decks
    return profile.decks.filter(
      (d) =>
        d.name.toLowerCase().includes(q) || (d.commander ?? '').toLowerCase().includes(q)
    )
  }, [profile, search])

  const deckColors = (deck: PublicDeck): string[] =>
    deck.colorIdentity && deck.colorIdentity.length
      ? deck.colorIdentity
      : (deck.commander ? resolved[deck.commander]?.colors : undefined) ?? []

  const deckArt = (deck: PublicDeck): string | null => {
    if (deck.commander && resolved[deck.commander]?.art) return resolved[deck.commander]!.art!
    if (deck.commander) return cardImageByName(deck.commander, 'normal')
    return null
  }

  const counts = (deck: PublicDeck) => (
    <span className="deck-card-counts">
      <span title="Likes">❤ {deck.likeCount ?? 0}</span>
      <span title="Comments">💬 {deck.commentCount ?? 0}</span>
      <span title="Views">👁 {deck.viewCount ?? 0}</span>
    </span>
  )

  return (
    <div className="profile-page">
      <header className="topnav profile-topnav">
        <h1 className="logo">
          <button type="button" className="link-btn logo-link" onClick={() => navigateToView('generate')}>
            <img src="/icon.png" alt="" /> Galaxy Commander
          </button>
        </h1>
        {isOwnProfile && (
          <button type="button" className="settings-btn profile-edit-btn" onClick={() => navigateToProfileSettings()}>
            Edit profile
          </button>
        )}
      </header>

      <main className="profile-main">
        {loading && <p className="hint profile-status">Loading profile…</p>}
        {!loading && error && <p className="auth-error profile-status">{error}</p>}
        {!loading && profile && (
          <>
            <section className="profile-header">
              <div className="profile-avatar-wrap">
                {profile.avatarUrl ? (
                  <img className="profile-avatar" src={profile.avatarUrl} alt="" />
                ) : (
                  <div className="profile-avatar profile-avatar-fallback" aria-hidden="true">
                    {(displayName[0] ?? '?').toUpperCase()}
                  </div>
                )}
              </div>
              <div className="profile-meta">
                <h2>{displayName}</h2>
                <p className="profile-handle">@{handle}</p>
                {profile.bio && <p className="profile-bio">{profile.bio}</p>}
                <div className="profile-stats">
                  <button type="button" className="profile-stat" onClick={() => setFollowModal('followers')}>
                    <strong>{followerCount}</strong> follower{followerCount === 1 ? '' : 's'}
                  </button>
                  <button type="button" className="profile-stat" onClick={() => setFollowModal('following')}>
                    <strong>{profile.followingCount}</strong> following
                  </button>
                  <span className="profile-stat static">
                    <strong>{profile.decks.length}</strong> deck{profile.decks.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="hint profile-joined">Joined {formatJoined(profile.createdAt)}</p>
              </div>
              <div className="profile-actions">
                {!isOwnProfile && (
                  <button
                    type="button"
                    className={`profile-follow-btn${following ? ' following' : ''}`}
                    onClick={() => void toggleFollow()}
                    disabled={followBusy}
                  >
                    {following ? 'Following' : 'Follow'}
                  </button>
                )}
                <button
                  type="button"
                  className="profile-share-btn"
                  onClick={() => void share()}
                  title="Copy profile link"
                >
                  <ShareIcon size={18} />
                  {shared ? 'Copied!' : 'Share'}
                </button>
              </div>
            </section>

            <section className="profile-decks">
              <div className="profile-decks-head">
                <h3>Decks</h3>
                <div className="profile-decks-controls">
                  <input
                    type="text"
                    className="deck-search"
                    placeholder="Search decks…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <div className="deckview-toggle">
                    <button
                      type="button"
                      className={viewMode === 'list' ? 'active' : ''}
                      onClick={() => setMode('list')}
                      title="List view"
                    >
                      ☰
                    </button>
                    <button
                      type="button"
                      className={viewMode === 'images' ? 'active' : ''}
                      onClick={() => setMode('images')}
                      title="Image view"
                    >
                      ▦
                    </button>
                  </div>
                </div>
              </div>

              {profile.decks.length === 0 ? (
                <p className="hint">No public decks yet.</p>
              ) : filteredDecks.length === 0 ? (
                <p className="hint">No decks match “{search}”.</p>
              ) : viewMode === 'images' ? (
                <div className="profile-deck-grid">
                  {filteredDecks.map((deck) => (
                    <button
                      key={deck.id}
                      type="button"
                      className="profile-deck-card"
                      onClick={() => navigateToDeck(handle, deck.id)}
                    >
                      <div
                        className="deck-card-banner"
                        style={{ backgroundImage: `url(${deckArt(deck) ?? ''})` }}
                      >
                        <ColorPips identity={deckColors(deck)} />
                      </div>
                      <div className="deck-card-info">
                        <strong>{deck.name}</strong>
                        {deck.commander && <small>{deck.commander}</small>}
                        {counts(deck)}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <ul className="profile-deck-list">
                  {filteredDecks.map((deck) => (
                    <li key={deck.id}>
                      <button
                        type="button"
                        className="profile-deck-row"
                        onClick={() => navigateToDeck(handle, deck.id)}
                      >
                        {deck.commander ? (
                          <img className="deck-row-thumb" src={cardImageByName(deck.commander, 'small')} alt="" loading="lazy" />
                        ) : (
                          <div className="deck-row-thumb deck-row-thumb-empty" />
                        )}
                        <div className="deck-row-main">
                          <strong>{deck.name}</strong>
                          <div className="deck-row-sub">
                            <ColorPips identity={deckColors(deck)} />
                            {deck.commander && <span className="deck-row-commander">{deck.commander}</span>}
                          </div>
                        </div>
                        <div className="deck-row-meta">
                          {counts(deck)}
                          <small>
                            {deck.cards} cards · {new Date(deck.updated).toLocaleDateString()}
                          </small>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>

      {followModal && profile && (
        <FollowListModal username={handle} mode={followModal} onClose={() => setFollowModal(null)} />
      )}
    </div>
  )
}
