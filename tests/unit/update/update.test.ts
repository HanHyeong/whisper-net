import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { canonicalJson } from '../../../src/main/update/canonicalJson.ts'
import { UpdateVerifier } from '../../../src/main/update/UpdateVerifier.ts'
import { compareSemver } from '../../../src/main/update/semver.ts'
import { isAllowedUpdateSharePath, isHiddenShareBrowsePath, isHiddenShareEntry } from '../../../src/main/update/paths.ts'

function signObject(obj: object, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']) {
  const bytes = Buffer.from(canonicalJson(obj), 'utf8')
  return sign(null, bytes, privateKey).toString('base64')
}

describe('canonicalJson', () => {
  it('sorts keys recursively', () => {
    const a = canonicalJson({ z: 1, a: { y: 2, b: 3 } })
    const b = canonicalJson({ a: { b: 3, y: 2 }, z: 1 })
    assert.equal(a, b)
  })
})

describe('semver', () => {
  it('compares versions', () => {
    assert.equal(compareSemver('1.9.0', '1.8.6'), 1)
    assert.equal(compareSemver('1.8.6', '1.9.0'), -1)
    assert.equal(compareSemver('1.8.6', '1.8.6'), 0)
  })
})

describe('paths guard', () => {
  it('allows verified update files only', () => {
    assert.equal(
      isAllowedUpdateSharePath('_whisper-updates/verified/channels/stable.json'),
      true
    )
    assert.equal(isAllowedUpdateSharePath('_whisper-updates/incoming/foo.exe'), false)
    assert.equal(isAllowedUpdateSharePath('_whisper-updates/verified/state.json'), false)
  })
})

describe('hidden share dirs', () => {
  it('hides system folders from browse paths', () => {
    assert.equal(isHiddenShareBrowsePath('_whisper-updates'), true)
    assert.equal(isHiddenShareBrowsePath('_whisper-updates/verified'), true)
    assert.equal(isHiddenShareBrowsePath('_roomsFiles'), true)
    assert.equal(isHiddenShareBrowsePath('documents'), false)
    assert.equal(isHiddenShareEntry('_whisper-updates'), true)
    assert.equal(isHiddenShareEntry('photos'), false)
  })
})

describe('UpdateVerifier', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

  const manifest = {
    schema: 1,
    manifestId: 'test-manifest-id',
    version: '1.9.0',
    channel: 'stable' as const,
    releasedAt: '2026-05-22T00:00:00Z',
    minAppVersion: '1.8.0',
    publisherKeyId: 'test-key',
    releaseNotes: 'test',
    artifacts: [
      {
        platform: process.platform,
        arch: process.arch,
        relativePath: 'artifacts/test/file.bin',
        fileName: 'file.bin',
        size: 4,
        sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      },
    ],
  }

  const verifier = new UpdateVerifier('1.8.6', { 'test-key': pubB64 })

  it('accepts valid manifest signature', () => {
    const json = canonicalJson(manifest)
    const sig = signObject(manifest, privateKey)
    const result = verifier.verifyManifest(json, sig)
    assert.equal(result.ok, true)
    assert.equal(result.data?.version, '1.9.0')
  })

  it('rejects tampered manifest signature', () => {
    const json = canonicalJson(manifest)
    const sig = signObject({ ...manifest, version: '9.9.9' }, privateKey)
    const result = verifier.verifyManifest(json, sig)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'bad_signature')
  })

  it('rejects downgrade below minAppVersion', () => {
    const oldVerifier = new UpdateVerifier('1.0.0', { 'test-key': pubB64 })
    const json = canonicalJson(manifest)
    const sig = signObject(manifest, privateKey)
    const result = oldVerifier.verifyManifest(json, sig)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'downgrade')
  })

  it('verifies artifact hash', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-update-'))
    const filePath = path.join(tmp, 'file.bin')
    const content = 'test'
    fs.writeFileSync(filePath, content)
    const artifact = {
      ...manifest.artifacts[0],
      size: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex'),
    }
    const result = await verifier.verifyArtifactFile(filePath, artifact)
    assert.equal(result.ok, true)
    fs.rmSync(tmp, { recursive: true })
  })

  it('rejects bad artifact hash', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-update-'))
    const filePath = path.join(tmp, 'file.bin')
    fs.writeFileSync(filePath, 'bad!')
    const artifact = manifest.artifacts[0]
    const result = await verifier.verifyArtifactFile(filePath, artifact)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'bad_hash')
    fs.rmSync(tmp, { recursive: true })
  })
})
