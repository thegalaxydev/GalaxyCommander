import { createServer } from 'node:http'
import { toNodeHandler } from 'better-auth/node'
import { auth } from './auth.js'
import { clientIp, rateLimit } from './rateLimit.js'
import { handleSessionMe, handleUserData } from './routes/userData.js'
import { handleProfileRoutes } from './routes/profile.js'
import { handleSocialRoutes, isSocialPath } from './routes/social.js'
import { captchaEnabled, captchaSiteKey } from './captcha.js'

const port = Number(process.env.API_PORT ?? 8788)
const authHandler = toNodeHandler(auth)

function corsHeaders(origin: string | undefined): Record<string, string> {
  const allowed = [
    process.env.APP_URL ?? '',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ].filter(Boolean)
  const ok = origin && allowed.some((a) => origin === a || origin.startsWith(a.replace(/\/$/, '')))
  if (!ok) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const origin = req.headers.origin
  const cors = corsHeaders(typeof origin === 'string' ? origin : undefined)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }

  const ip = clientIp(req)
  const path = url.pathname

  if (path === '/api/auth/captcha-config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors })
    res.end(
      JSON.stringify({
        enabled: captchaEnabled(),
        siteKey: captchaSiteKey(),
      })
    )
    return
  }

  if (path.startsWith('/api/auth')) {
    if (
      rateLimit(`auth:${ip}:${path}`, 30, 60_000) &&
      (path.includes('sign-in') || path.includes('sign-up') || path.includes('request-password-reset'))
    ) {
      res.writeHead(429, { 'Content-Type': 'application/json', ...cors })
      res.end(JSON.stringify({ error: 'Too many requests. Try again later.' }))
      return
    }
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v))
    return authHandler(req, res)
  }

  if (path === '/api/session' && req.method === 'GET') {
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v))
    return handleSessionMe(req, res)
  }

  if (path === '/api/user/data' || path === '/api/user/data/merge') {
    if (rateLimit(`userdata:${ip}`, 120, 60_000)) {
      res.writeHead(429, { 'Content-Type': 'application/json', ...cors })
      res.end(JSON.stringify({ error: 'Too many requests.' }))
      return
    }
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v))
    return handleUserData(req, res)
  }

  if (isSocialPath(path)) {
    const commentPost = req.method === 'POST' && /\/comments$/.test(path)
    const limited = commentPost
      ? rateLimit(`comment:${ip}`, 10, 60_000)
      : rateLimit(`social:${ip}`, 120, 60_000)
    if (limited) {
      res.writeHead(429, { 'Content-Type': 'application/json', ...cors })
      res.end(JSON.stringify({ error: 'Too many requests.' }))
      return
    }
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v))
    return handleSocialRoutes(req, res, path)
  }

  if (path.startsWith('/api/users/') || path.startsWith('/api/me/')) {
    if (rateLimit(`profile:${ip}`, 120, 60_000)) {
      res.writeHead(429, { 'Content-Type': 'application/json', ...cors })
      res.end(JSON.stringify({ error: 'Too many requests.' }))
      return
    }
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v))
    return handleProfileRoutes(req, res, path)
  }

  if (path === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...cors })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json', ...cors })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(port, '127.0.0.1', () => {
  console.log(`galaxy-commander-api listening on 127.0.0.1:${port}`)
})

process.on('SIGTERM', () => server.close())
