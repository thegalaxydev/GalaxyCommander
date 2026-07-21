import { useEffect, useState } from 'react'
import { fetchFollowList, type ProfileUser } from '../auth/social'
import { navigateToUserProfile } from '../route'

interface Props {
  username: string
  mode: 'followers' | 'following'
  onClose: () => void
}

export function FollowListModal({ username, mode, onClose }: Props) {
  const [users, setUsers] = useState<ProfileUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchFollowList(username, mode)
      .then((res) => {
        if (!cancelled) setUsers(res.users)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load list')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [username, mode])

  const go = (u: ProfileUser) => {
    if (!u.username) return
    onClose()
    navigateToUserProfile(u.username)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal follow-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{mode === 'followers' ? 'Followers' : 'Following'}</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="follow-modal-body">
          {loading && <p className="hint">Loading…</p>}
          {error && <p className="auth-error">{error}</p>}
          {!loading && !error && users.length === 0 && (
            <p className="hint">{mode === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p>
          )}
          <ul className="follow-list">
            {users.map((u) => (
              <li key={u.username ?? u.displayName}>
                <button type="button" className="follow-list-item" onClick={() => go(u)}>
                  {u.avatarUrl ? (
                    <img src={u.avatarUrl} alt="" />
                  ) : (
                    <div className="follow-list-avatar-fallback">
                      {(u.displayName[0] ?? '?').toUpperCase()}
                    </div>
                  )}
                  <div>
                    <strong>{u.displayName}</strong>
                    {u.username && <small>@{u.username}</small>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
