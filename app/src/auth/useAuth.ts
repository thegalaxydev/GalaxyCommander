import { useCallback, useEffect, useState } from 'react'
import { authClient, type AuthUser } from './client'
import { fetchSessionUser, mergeOnLogin, setSyncEnabled } from './sync'

export function useAuth() {
  const { data: session, isPending, refetch } = authClient.useSession()
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    if (session?.user) {
      setUser(session.user as AuthUser)
      setSyncEnabled(true)
    } else if (!isPending) {
      setUser(null)
      setSyncEnabled(false)
    }
  }, [session, isPending])

  const refresh = useCallback(async () => {
    const u = await fetchSessionUser()
    setUser(u)
    setSyncEnabled(!!u)
    await refetch()
    return u
  }, [refetch])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await authClient.signIn.email({ email, password })
      if (res.error) throw new Error(res.error.message ?? 'Sign in failed')
      await mergeOnLogin()
      await refresh()
      window.dispatchEvent(new Event('gc-user-data-changed'))
    },
    [refresh]
  )

  const signUp = useCallback(
    async (username: string, email: string, password: string, captchaToken?: string | null) => {
      const res = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: username,
          username,
          email,
          password,
          captchaToken: captchaToken ?? undefined,
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        message?: string
        error?: { message?: string }
      } | null
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error?.message ?? 'Sign up failed')
      }
      await mergeOnLogin()
      await refresh()
      window.dispatchEvent(new Event('gc-user-data-changed'))
    },
    [refresh]
  )

  const signOut = useCallback(async () => {
    await authClient.signOut()
    setUser(null)
    setSyncEnabled(false)
    await refetch()
  }, [refetch])

  const forgotPassword = useCallback(async (email: string) => {
    const res = await fetch('/api/auth/request-password-reset', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirectTo: `${window.location.origin}/generate` }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null
      throw new Error(data?.message ?? 'Could not send reset email')
    }
  }, [])

  return {
    user,
    loading: isPending,
    signIn,
    signUp,
    signOut,
    forgotPassword,
    refresh,
  }
}
