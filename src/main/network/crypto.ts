import crypto from 'crypto'

const ROOM_SALT = 'whisper-net-v1'
const GENERAL_SALT = 'whisper-net-general'
const PBKDF2_ITERATIONS = 100000
const GENERAL_ITERATIONS = 1000 // lower because master key + random roomId is already strong
const KEY_LENGTH = 32 // 256 bits for AES-256

// Master key for general (public) rooms.
// Note: In a client-side Electron app, secrets cannot be perfectly hidden.
// This key provides network-level encryption against passive sniffing.
const GENERAL_MASTER_KEY = Buffer.from('whisper-net-general-master-key!', 'utf-8')

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
  return crypto.pbkdf2Sync(GENERAL_MASTER_KEY, roomId + GENERAL_SALT, GENERAL_ITERATIONS, KEY_LENGTH, 'sha256')
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


