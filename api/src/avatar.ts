import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const AVATAR_DIR = process.env.AVATAR_DIR ?? '/var/www/commander.thegalaxy.dev/avatars'
export const MAX_AVATAR_MB = 2
export const MAX_AVATAR_BYTES = MAX_AVATAR_MB * 1024 * 1024

export function avatarTooLargeMessage(): string {
  return `Image must be ${MAX_AVATAR_MB} MB or smaller.`
}

const EXT_BY_TYPE = {
  jpg: 'jpg',
  png: 'png',
  gif: 'gif',
  webp: 'webp',
} as const

export type AvatarImageType = keyof typeof EXT_BY_TYPE

export function detectImageType(buf: Buffer): AvatarImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif'
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'webp'
  }
  return null
}

export async function removeUserAvatars(userId: string): Promise<void> {
  const files = await readdir(AVATAR_DIR).catch(() => [] as string[])
  await Promise.all(
    files.filter((f) => f.startsWith(`${userId}.`)).map((f) => unlink(join(AVATAR_DIR, f)).catch(() => {}))
  )
}

export async function saveUserAvatar(userId: string, buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw new Error(avatarTooLargeMessage())
  }
  const imageType = detectImageType(buffer)
  if (!imageType) throw new Error('Only JPEG, PNG, WebP, and GIF images are allowed.')

  await mkdir(AVATAR_DIR, { recursive: true })
  await removeUserAvatars(userId)
  const ext = EXT_BY_TYPE[imageType]
  const filename = `${userId}.${ext}`
  await writeFile(join(AVATAR_DIR, filename), buffer)
  return `/avatars/${filename}?t=${Date.now()}`
}
