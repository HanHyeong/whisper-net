import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { cleanIncomingDir, pruneVerifiedUpdates } from '../../../src/main/update/cleanup.ts'
import type { ArtifactEntry, ReleaseManifest } from '../../../src/main/update/types.ts'

const manifest: ReleaseManifest = {
  schema: 1,
  manifestId: 'm1',
  version: '1.9.0',
  channel: 'stable',
  releasedAt: '2026-05-22T00:00:00Z',
  minAppVersion: '1.8.0',
  publisherKeyId: 'test',
  releaseNotes: 'test',
  artifacts: [],
}

const artifact: ArtifactEntry = {
  platform: 'win32',
  arch: 'x64',
  relativePath: 'artifacts/win32-x64/Whisper Net Setup 1.9.0.exe',
  fileName: 'Whisper Net Setup 1.9.0.exe',
  size: 1,
  sha256: 'a'.repeat(64),
}

describe('update cleanup', () => {
  it('removes old manifests and artifacts, keeps current only', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-cleanup-'))
    const verified = path.join(root, 'verified')
    const manifests = path.join(verified, 'manifests')
    const winDir = path.join(verified, 'artifacts', 'win32-x64')
    const macDir = path.join(verified, 'artifacts', 'darwin-arm64')

    fs.mkdirSync(manifests, { recursive: true })
    fs.mkdirSync(winDir, { recursive: true })
    fs.mkdirSync(macDir, { recursive: true })

    fs.writeFileSync(path.join(manifests, 'release-1.8.0.manifest.json'), '{}')
    fs.writeFileSync(path.join(manifests, 'release-1.8.0.manifest.json.sig'), 'sig')
    fs.writeFileSync(path.join(manifests, 'release-1.9.0.manifest.json'), '{}')
    fs.writeFileSync(path.join(manifests, 'release-1.9.0.manifest.json.sig'), 'sig')

    fs.writeFileSync(path.join(winDir, 'Whisper Net Setup 1.8.0.exe'), 'old')
    fs.writeFileSync(path.join(winDir, artifact.fileName), 'new')
    fs.writeFileSync(path.join(macDir, 'Whisper Net-1.8.0.dmg'), 'mac-old')

    pruneVerifiedUpdates(verified, manifest, artifact)

    assert.equal(fs.existsSync(path.join(manifests, 'release-1.8.0.manifest.json')), false)
    assert.equal(fs.existsSync(path.join(manifests, 'release-1.9.0.manifest.json')), true)
    assert.equal(fs.existsSync(path.join(winDir, 'Whisper Net Setup 1.8.0.exe')), false)
    assert.equal(fs.existsSync(path.join(winDir, artifact.fileName)), true)
    assert.equal(fs.existsSync(macDir), false)

    fs.rmSync(root, { recursive: true })
  })

  it('clears incoming directory', () => {
    const incoming = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-incoming-'))
    fs.writeFileSync(path.join(incoming, 'partial.bin'), 'x')
    cleanIncomingDir(incoming)
    assert.equal(fs.existsSync(incoming), false)
  })
})
