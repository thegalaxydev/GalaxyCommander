import { useEffect, useRef, useState } from 'react'
import {
  checkUsernameAvailable,
  fetchMyProfile,
  removeMyAvatar,
  updateMyProfile,
  updateMyUsername,
  uploadMyAvatar,
  type MyProfile,
} from '../auth/profile'
import { isSameUsername, validateUsername } from '../auth/validation'
import { loadSavedDecks, renameSavedDeck } from '../cod'
import { navigateToUserProfile, navigateToView } from '../route'

const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'

function applyPublicDeckFlags(publicDeckIds: string[]) {
  const publicSet = new Set(publicDeckIds)
  const decks = loadSavedDecks().map((d) => ({ ...d, public: publicSet.has(d.id) }))
  localStorage.setItem('gc-saved-decks', JSON.stringify(decks))
  window.dispatchEvent(new Event('gc-user-data-changed'))
}

function formatChangeDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export function ProfileSettingsPage({
  onAuthRequired,
  onUsernameChanged,
}: {
  onAuthRequired: () => void
  onUsernameChanged: (username: string) => void
}) {
  const [profile, setProfile] = useState<MyProfile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [username, setUsername] = useState('')
  const [publicDeckIds, setPublicDeckIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [usernameHint, setUsernameHint] = useState<string | null>(null)
  const [usernameOk, setUsernameOk] = useState<boolean | null>(null)
  const [deckNames, setDeckNames] = useState<Record<string, string>>({})
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchMyProfile()
        if (cancelled) return
        setProfile(data)
        setDisplayName(data.displayName)
        setBio(data.bio ?? '')
        setAvatarUrl(data.avatarUrl ?? '')
        setUsername(data.username ?? '')
        setPublicDeckIds(new Set(data.decks.filter((d) => d.public).map((d) => d.id)))
        setDeckNames(Object.fromEntries(data.decks.map((d) => [d.id, d.name])))
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Could not load profile'
          if (msg.toLowerCase().includes('unauthorized')) onAuthRequired()
          else setError(msg)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onAuthRequired])

  useEffect(() => {
    if (!profile?.username) return
    const trimmed = username.trim()
    if (trimmed === profile.username) {
      setUsernameHint(null)
      setUsernameOk(null)
      return
    }
    const formatErr = validateUsername(trimmed)
    if (formatErr) {
      setUsernameHint(formatErr)
      setUsernameOk(null)
      return
    }
    if (isSameUsername(trimmed, profile.username)) {
      setUsernameOk(true)
      setUsernameHint('Only changing capitalization.')
      return
    }
    if (!profile.canChangeUsername) {
      setUsernameOk(false)
      setUsernameHint(
        profile.usernameChangeAvailableAt
          ? `You can change your username again on ${formatChangeDate(profile.usernameChangeAvailableAt)}.`
          : 'You cannot change your username right now.'
      )
      return
    }
    setUsernameHint(null)
    const timer = setTimeout(async () => {
      try {
        const available = await checkUsernameAvailable(trimmed)
        if (available) {
          setUsernameOk(true)
          setUsernameHint('Username is available.')
        } else {
          setUsernameOk(false)
          setUsernameHint('That username is already taken.')
        }
      } catch {
        setUsernameOk(null)
        setUsernameHint(null)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [username, profile])

  const toggleDeckPublic = (id: string) => {
    setPublicDeckIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const commitDeckRename = (id: string) => {
    const current = profile?.decks.find((d) => d.id === id)
    const nextName = (deckNames[id] ?? current?.name ?? '').trim()
    setEditingDeckId(null)
    if (!nextName) {
      if (current) setDeckNames((prev) => ({ ...prev, [id]: current.name }))
      return
    }
    if (current && nextName === current.name) return
    const updated = renameSavedDeck(id, nextName)
    if (!updated) {
      if (current) setDeckNames((prev) => ({ ...prev, [id]: current.name }))
      return
    }
    setProfile((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        decks: prev.decks.map((d) =>
          d.id === id
            ? { ...d, name: updated.name, updated: updated.updated, public: d.public ?? false }
            : { ...d, public: d.public ?? false }
        ),
      }
    })
    setDeckNames((prev) => ({ ...prev, [id]: updated.name }))
  }

  const cancelDeckRename = (id: string) => {
    const current = profile?.decks.find((d) => d.id === id)
    setEditingDeckId(null)
    if (current) setDeckNames((prev) => ({ ...prev, [id]: current.name }))
  }

  const handleAvatarPick = async (file: File | null) => {
    if (!file) return
    setAvatarBusy(true)
    setError(null)
    setMessage(null)
    try {
      const url = await uploadMyAvatar(file)
      setAvatarUrl(url)
      setMessage('Avatar updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload avatar')
    } finally {
      setAvatarBusy(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  const handleAvatarRemove = async () => {
    setAvatarBusy(true)
    setError(null)
    setMessage(null)
    try {
      await removeMyAvatar()
      setAvatarUrl('')
      setMessage('Avatar removed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove avatar')
    } finally {
      setAvatarBusy(false)
    }
  }

  const saveProfile = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const trimmedName = displayName.trim()
      if (!trimmedName) throw new Error('Display name is required.')

      await updateMyProfile({
        displayName: trimmedName,
        bio,
        publicDeckIds: [...publicDeckIds],
      })

      const trimmedUsername = username.trim()
      if (profile?.username && trimmedUsername && trimmedUsername !== profile.username) {
        const userErr = validateUsername(trimmedUsername)
        if (userErr) throw new Error(userErr)
        const capitalizationOnly = isSameUsername(trimmedUsername, profile.username)
        if (!capitalizationOnly) {
          if (!profile.canChangeUsername) {
            throw new Error(
              profile.usernameChangeAvailableAt
                ? `You can change your username again on ${formatChangeDate(profile.usernameChangeAvailableAt)}.`
                : 'You cannot change your username right now.'
            )
          }
          if (usernameOk === false) throw new Error('That username is already taken.')
        }
        await updateMyUsername(trimmedUsername)
        onUsernameChanged(trimmedUsername)
      }

      const refreshed = await fetchMyProfile()
      setProfile(refreshed)
      setUsername(refreshed.username ?? trimmedUsername)
      setAvatarUrl(refreshed.avatarUrl ?? '')
      setPublicDeckIds(new Set(refreshed.decks.filter((d) => d.public).map((d) => d.id)))
      applyPublicDeckFlags([...publicDeckIds])
      setMessage('Profile saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="profile-page">
      <header className="topnav profile-topnav">
        <h1 className="logo">
          <button type="button" className="link-btn logo-link" onClick={() => navigateToView('generate')}>
            <img src="/icon.png" alt="" /> Galaxy Commander
          </button>
        </h1>
      </header>

      <main className="profile-main profile-settings">
        <h2>Profile settings</h2>
        {loading && <p className="hint">Loading…</p>}
        {!loading && (
          <div className="auth-form profile-settings-form">
            <label className="settings-field">
              <span>Display name</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} />
            </label>
            <label className="settings-field">
              <span>Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                spellCheck={false}
                maxLength={24}
              />
              {usernameHint && (
                <small className={usernameOk ? 'auth-field-ok' : usernameOk === false ? 'auth-field-bad' : 'auth-field-hint'}>
                  {usernameHint}
                </small>
              )}
              {profile?.canChangeUsername === false &&
                profile.usernameChangeAvailableAt &&
                username.trim() === (profile.username ?? '') && (
                  <small className="auth-field-hint">
                    Next username change available on {formatChangeDate(profile.usernameChangeAvailableAt)}.
                  </small>
                )}
            </label>
            <label className="settings-field">
              <span>Bio</span>
              <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} rows={4} />
            </label>
            <div className="settings-field profile-avatar-field">
              <span>Avatar</span>
              <div className="profile-avatar-upload">
                {avatarUrl ? (
                  <img className="profile-avatar profile-avatar-preview" src={avatarUrl} alt="" />
                ) : (
                  <div className="profile-avatar profile-avatar-fallback profile-avatar-preview" aria-hidden="true">
                    {(displayName[0] ?? '?').toUpperCase()}
                  </div>
                )}
                <div className="profile-avatar-actions">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept={AVATAR_ACCEPT}
                    className="profile-avatar-input"
                    disabled={avatarBusy}
                    onChange={(e) => void handleAvatarPick(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    className="new-build"
                    disabled={avatarBusy}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    {avatarBusy ? 'Uploading…' : 'Upload image'}
                  </button>
                  {avatarUrl && (
                    <button type="button" className="link-btn" disabled={avatarBusy} onClick={() => void handleAvatarRemove()}>
                      Remove
                    </button>
                  )}
                </div>
                <small className="auth-field-hint">JPEG, PNG, WebP, or GIF. Max 2 MB.</small>
              </div>
            </div>

            {profile && profile.decks.length > 0 && (
              <div className="profile-public-decks">
                <span className="settings-field-label">Your decks</span>
                <ul className="profile-deck-toggle-list">
                  {profile.decks.map((deck) => (
                    <li key={deck.id}>
                      <div className="profile-deck-toggle">
                        <input
                          type="checkbox"
                          checked={publicDeckIds.has(deck.id)}
                          onChange={() => toggleDeckPublic(deck.id)}
                          title="Show on public profile"
                        />
                        <span className="profile-deck-info">
                          {editingDeckId === deck.id ? (
                            <input
                              className="profile-deck-name-input"
                              value={deckNames[deck.id] ?? deck.name}
                              maxLength={120}
                              autoFocus
                              onChange={(e) => setDeckNames((prev) => ({ ...prev, [deck.id]: e.target.value }))}
                              onBlur={() => commitDeckRename(deck.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur()
                                if (e.key === 'Escape') cancelDeckRename(deck.id)
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="profile-deck-name-btn"
                              onClick={() => setEditingDeckId(deck.id)}
                              title="Click to rename"
                            >
                              {deckNames[deck.id] ?? deck.name}
                            </button>
                          )}
                          <small>{deck.cards} cards · click name to edit</small>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <p className="auth-error">{error}</p>}
            {message && <p className="auth-message">{message}</p>}
            <div className="profile-settings-actions">
              <button type="button" className="generate-btn auth-submit" disabled={busy} onClick={() => void saveProfile()}>
                {busy ? 'Saving…' : 'Save profile'}
              </button>
              {profile?.username && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => navigateToUserProfile(profile.username!)}
                >
                  View public profile
                </button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
