import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { UpdateAvailabilityStore } from '../../../src/main/update/UpdateAvailabilityStore.ts'
import { rankDownloadSources, rankProbePeers } from '../../../src/main/update/UpdateSourceSelector.ts'
import { PeerInfo } from '../../../src/main/network/protocol.ts'
import { ReleaseManifest, UpdateAvailabilityPayload } from '../../../src/main/update/types.ts'

function peer(id: string, overrides: Partial<PeerInfo> = {}): PeerInfo {
  return {
    peerId: id,
    nickname: id,
    ip: '192.168.1.10',
    tcpPort: 41235,
    discoveryPort: 8080,
    lastSeen: Date.now(),
    rooms: [],
    ...overrides,
  }
}

function availability(
  overrides: Partial<UpdateAvailabilityPayload> = {}
): UpdateAvailabilityPayload {
  return {
    channel: 'stable',
    version: '2.0.0',
    manifestId: 'manifest-1',
    publisherKeyId: 'test-key',
    platform: process.platform,
    arch: process.arch,
    artifactSha256: 'abc123',
    artifactSize: 100,
    role: 'mirror',
    manifestRelativePath: 'manifests/release-2.0.0.manifest.json',
    manifestSigRelativePath: 'manifests/release-2.0.0.manifest.json.sig',
    artifactRelativePath: 'artifacts/test/file.bin',
    activeServes: 0,
    ...overrides,
  }
}

describe('UpdateSourceSelector', () => {
  it('prioritizes gossip peers with newer versions for probe order', () => {
    const store = new UpdateAvailabilityStore()
    store.upsert('mirror-a', availability({ role: 'mirror', version: '2.0.0' }))
    store.upsert('origin-b', availability({ role: 'origin', version: '2.0.0' }))

    const peers = [peer('other'), peer('origin-b'), peer('mirror-a')]
    const ordered = rankProbePeers(peers, store, 'stable', '1.9.0')

    assert.equal(ordered[0].peerId, 'mirror-a')
    assert.equal(ordered[1].peerId, 'origin-b')
    assert.equal(ordered[2].peerId, 'other')
  })

  it('prefers mirrors over origin for download sources', () => {
    const store = new UpdateAvailabilityStore()
    store.upsert('mirror-a', availability({ role: 'mirror', activeServes: 1 }))
    store.upsert('origin-b', availability({ role: 'origin', activeServes: 0 }))

    const manifest: ReleaseManifest = {
      schema: 1,
      manifestId: 'manifest-1',
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
          size: 100,
          sha256: 'abc123',
        },
      ],
    }

    const peers = [peer('origin-b'), peer('mirror-a')]
    const sources = rankDownloadSources(peers, store, manifest, manifest.artifacts[0], {
      peerId: 'origin-b',
      nickname: 'origin-b',
      ip: '192.168.1.10',
      discoveryPort: 8080,
      role: 'origin',
      activeServes: 0,
    })

    assert.equal(sources[0].peerId, 'mirror-a')
    assert.equal(sources[0].role, 'mirror')
    assert.equal(sources[1].peerId, 'origin-b')
  })

  it('does not prioritize gossip with version not newer than current', () => {
    const store = new UpdateAvailabilityStore()
    store.upsert('old', availability({ version: '1.8.0' }))

    const peers = [peer('old'), peer('fresh')]
    const ordered = rankProbePeers(peers, store, 'stable', '1.9.0')

    assert.deepEqual(
      ordered.map((p) => p.peerId),
      ['old', 'fresh']
    )
  })
})
