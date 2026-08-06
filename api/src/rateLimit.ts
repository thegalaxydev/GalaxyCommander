const buckets = new Map<string, { count: number; reset: number }>()

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = buckets.get(key)
  if (!entry || now > entry.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs })
    return false
  }
  entry.count++
  if (entry.count > limit) return true
  return false
}

export function clientIp(req: import('node:http').IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string') return fwd.split(',')[0]?.trim() || 'unknown'
  return req.socket.remoteAddress ?? 'unknown'
}

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of buckets) {
    if (now > v.reset) buckets.delete(k)
  }
}, 60_000).unref()
