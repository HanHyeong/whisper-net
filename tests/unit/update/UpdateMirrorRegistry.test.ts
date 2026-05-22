import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { UpdateMirrorRegistry } from '../../../src/main/update/UpdateMirrorRegistry.ts'
import { DEFAULT_UPDATE_SETTINGS } from '../../../src/main/update/types.ts'

describe('UpdateMirrorRegistry', () => {
  it('enforces maxConcurrentServes for artifact downloads', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-mirror-'))
    const verified = path.join(root, 'verified')
    const manifestDir = path.join(verified, 'manifests')
    fs.mkdirSync(manifestDir, { recursive: true })

    const manifest = {
      schema: 1,
      manifestId: 'm1',
      version: '2.0.0',
      channel: 'stable',
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
          sha256: 'abc',
        },
      ],
    }

    fs.writeFileSync(path.join(manifestDir, 'release-2.0.0.manifest.json'), JSON.stringify(manifest))
    const artifactPath = path.join(verified, 'artifacts/test/file.bin')
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
    fs.writeFileSync(artifactPath, Buffer.alloc(4))

    const registry = new UpdateMirrorRegistry({
      getVerifiedDir: () => verified,
      getSharedPath: () => null,
      getSettings: () => ({ ...DEFAULT_UPDATE_SETTINGS, maxConcurrentServes: 1 }),
      getPlatformArch: () => ({ platform: process.platform, arch: process.arch }),
    })
    registry.scanLocal()

    const rel = '_whisper-updates/verified/artifacts/test/file.bin'
    assert.equal(registry.tryBeginServe(rel), true)
    assert.equal(registry.tryBeginServe(rel), false)
    registry.endServe()
    assert.equal(registry.tryBeginServe(rel), true)
  })

  it('does not gossip availability when mirrorEnabled is false', () => {
    const registry = new UpdateMirrorRegistry({
      getVerifiedDir: () => '/tmp/none',
      getSharedPath: () => null,
      getSettings: () => ({ ...DEFAULT_UPDATE_SETTINGS, mirrorEnabled: false }),
      getPlatformArch: () => ({ platform: process.platform, arch: process.arch }),
    })

    registry.registerAfterDownload(
      {
        schema: 1,
        manifestId: 'm1',
        version: '2.0.0',
        channel: 'stable',
        releasedAt: '2026-05-22T00:00:00Z',
        minAppVersion: '1.8.0',
        publisherKeyId: 'test-key',
        releaseNotes: 'test',
        artifacts: [],
      },
      {
        platform: process.platform,
        arch: process.arch,
        relativePath: 'artifacts/test/file.bin',
        fileName: 'file.bin',
        size: 4,
        sha256: 'abc',
      }
    )

    assert.equal(registry.canSendAvailability(), false)
    assert.equal(registry.getLocalAvailability(), null)
  })
})
