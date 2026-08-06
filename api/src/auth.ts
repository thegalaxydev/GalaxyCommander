import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { username } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { Resend } from 'resend'
import { db } from './db/index.js'
import * as schema from './db/schema.js'
import { validatePassword } from './validation.js'
import { validateUsername } from './username.js'
import { captchaEnabled, verifyCaptchaToken } from './captcha.js'

const resendKey = process.env.RESEND_API_KEY
const resend = resendKey ? new Resend(resendKey) : null
const emailFrom = process.env.EMAIL_FROM ?? 'Galaxy Commander <noreply@commander.thegalaxy.dev>'

async function sendAuthEmail(to: string, subject: string, html: string) {
  if (!resend) {
    console.warn('[auth] RESEND_API_KEY not set; email not sent:', subject, 'to', to)
    return
  }
  await resend.emails.send({ from: emailFrom, to, subject, html })
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.API_URL ?? 'http://127.0.0.1:8788',
  trustedOrigins: [
    process.env.APP_URL ?? 'http://localhost:5173',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ],
  plugins: [username({ minUsernameLength: 3, maxUsernameLength: 24 })],
  databaseHooks: {
    user: {
      create: {
        after: async (created) => {
          const usernameValue = typeof created.username === 'string' ? created.username : null
          if (!usernameValue) return
          const displayUsername =
            typeof created.displayUsername === 'string' ? created.displayUsername : usernameValue
          const image = typeof created.image === 'string' ? created.image : null
          await db
            .update(schema.user)
            .set({
              usernameNormalized: usernameValue.toLowerCase(),
              displayName: displayUsername,
              avatarUrl: image,
            })
            .where(eq(schema.user.id, created.id))
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-up/email') {
        const usernameValue = ctx.body?.username
        if (typeof usernameValue === 'string') {
          const err = validateUsername(usernameValue)
          if (err) throw new APIError('BAD_REQUEST', { message: err })
        }
        if (captchaEnabled()) {
          const token = ctx.body?.captchaToken
          const ip =
            ctx.request?.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            ctx.request?.headers?.get('x-real-ip') ||
            undefined
          const ok = await verifyCaptchaToken(typeof token === 'string' ? token : '', ip)
          if (!ok) {
            throw new APIError('BAD_REQUEST', { message: 'Captcha verification failed. Please try again.' })
          }
        }
      }
      if (
        ctx.path !== '/sign-up/email' &&
        ctx.path !== '/reset-password' &&
        ctx.path !== '/change-password'
      ) {
        return
      }
      const password = ctx.body?.password ?? ctx.body?.newPassword
      if (typeof password !== 'string') return
      const err = validatePassword(password)
      if (err) throw new APIError('BAD_REQUEST', { message: err })
    }),
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail(
        user.email,
        'Reset your Galaxy Commander password',
        `<p>Hi ${user.name},</p><p><a href="${url}">Reset your password</a></p><p>This link expires soon.</p>`
      )
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail(
        user.email,
        'Verify your Galaxy Commander email',
        `<p>Hi ${user.name},</p><p><a href="${url}">Verify your email</a></p>`
      )
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  advanced: {
    useSecureCookies: process.env.COOKIE_SECURE === 'true',
    defaultCookieAttributes: {
      sameSite: (process.env.COOKIE_SAME_SITE as 'lax' | 'strict' | 'none') ?? 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      httpOnly: true,
      path: '/',
    },
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
      trustedProxies: ['127.0.0.1', '::1'],
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
    storage: 'memory',
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
      '/request-password-reset': { window: 300, max: 3 },
      '/reset-password': { window: 300, max: 5 },
    },
  },
})

export type Session = typeof auth.$Infer.Session
