import { createAuthClient } from 'better-auth/react'
import { usernameClient } from 'better-auth/client/plugins'

const baseURL = typeof window !== 'undefined' ? window.location.origin : ''

export const authClient = createAuthClient({
  baseURL,
  plugins: [usernameClient()],
})

export type AuthUser = {
  id: string
  name: string
  email: string
  username?: string | null
  displayUsername?: string | null
  image?: string | null
}
