import crypto from 'crypto'

const ROOM_SALT = 'whisper-net-v1'
const GENERAL_SALT = 'whisper-net-general'
const PBKDF2_ITERATIONS = 100000
const GENERAL_ITERATIONS = 1000 // lower because master key + random roomId is already strong
const KEY_LENGTH = 32 // 256 bits for AES-256

function getGeneralMasterKey(): Buffer {
  const key = process.env.WHISPER_GENERAL_MASTER_KEY
  if (!key) {
    throw new Error('WHISPER_GENERAL_MASTER_KEY is not set. Create a .env file based on .env.example')
  }
  return Buffer.from(key, 'utf-8')
}

/**
 * Derive an AES-256 key from a password and roomId using PBKDF2.
 * roomId is used as part of the salt so each room has a unique key even with the same password.
 */
export function deriveKey(password: string, roomId: string): Buffer {
  return crypto.pbkdf2Sync(password, roomId + ROOM_SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
}

/**
 * Derive a general room key from roomId (no password needed).
 * Uses a hardcoded master key so network sniffers can't decrypt without source access.
 */
export function deriveGeneralKey(roomId: string): Buffer {
  return crypto.pbkdf2Sync(getGeneralMasterKey(), roomId + GENERAL_SALT, GENERAL_ITERATIONS, KEY_LENGTH, 'sha256')
}

/**
 * Hash a password for storage/verification (not for encryption).
 */
export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + ROOM_SALT).digest('hex')
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns: base64(iv) + ':' + base64(authTag) + ':' + base64(ciphertext)
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

/**
 * Decrypt ciphertext produced by encrypt().
 * Throws if decryption fails (wrong key, tampered data).
 */
export function decrypt(ciphertext: string, key: Buffer): string {
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(':')
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const encrypted = Buffer.from(encryptedB64, 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf-8')
}

const HMAC_WINDOW_MS = 60000 // 1 minute replay window

function getHmacSecret(): string {
  const secret = process.env.WHISPER_HMAC_SECRET
  if (!secret) {
    throw new Error('WHISPER_HMAC_SECRET is not set. Create a .env file based on .env.example')
  }
  return secret
}

/**
 * Sign a request path with timestamp for HMAC authentication.
 */
export function signRequest(path: string, timestamp: number): string {
  return crypto.createHmac('sha256', getHmacSecret()).update(`${path}:${timestamp}`).digest('hex')
}

/**
 * Verify HMAC signature for a request path.
 * Also checks timestamp to prevent replay attacks.
 */
export function verifyRequest(path: string, timestamp: number, signature: string): boolean {
  const now = Date.now()
  if (Math.abs(now - timestamp) > HMAC_WINDOW_MS) return false
  const expected = signRequest(path, timestamp)
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

/**
 * Append HMAC signature query parameters to a URL.
 */
export function signUrl(urlStr: string): string {
  const u = new URL(urlStr)
  const path = u.pathname
  const ts = Date.now()
  const sig = signRequest(path, ts)
  u.searchParams.set('ts', String(ts))
  u.searchParams.set('sig', sig)
  return u.toString()
}
