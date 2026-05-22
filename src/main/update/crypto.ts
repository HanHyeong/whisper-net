import fs from 'fs'
import { createHash, createPublicKey, createPrivateKey, sign, verify, KeyObject } from 'crypto'
import { canonicalJson } from './canonicalJson'

export function importPublicKeyBase64(base64: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(base64, 'base64'),
    format: 'der',
    type: 'spki',
  })
}

export function importPrivateKeyPem(pem: string): KeyObject {
  return createPrivateKey(pem)
}

export function signCanonicalJson(value: unknown, privateKey: KeyObject): string {
  const bytes = Buffer.from(canonicalJson(value), 'utf8')
  const signature = sign(null, bytes, privateKey)
  return signature.toString('base64')
}

export function verifyCanonicalJson(value: unknown, signatureBase64: string, publicKey: KeyObject): boolean {
  try {
    const bytes = Buffer.from(canonicalJson(value), 'utf8')
    const signature = Buffer.from(signatureBase64, 'base64')
    return verify(null, bytes, publicKey, signature)
  } catch {
    return false
  }
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    })
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

export { createHash }
