import { PeerInfo } from '../network/protocol'
import { CachedAvailability, UpdateAvailabilityStore } from './UpdateAvailabilityStore'
import { compareSemver } from './semver'
import {
  ArtifactEntry,
  ReleaseManifest,
  UpdateChannel,
  UpdateSourceCandidate,
} from './types'

export function rankProbePeers(
  peers: PeerInfo[],
  store: UpdateAvailabilityStore,
  channel: UpdateChannel,
  currentVersion: string,
  preferredOriginPeerId?: string
): PeerInfo[] {
  const gossipPeers = store
    .listForChannel(channel, currentVersion)
    .sort(compareAvailability)
    .map((entry) => peers.find((p) => p.peerId === entry.peerId))
    .filter((p): p is PeerInfo => Boolean(p))

  const seen = new Set<string>()
  const ordered: PeerInfo[] = []

  if (preferredOriginPeerId) {
    const preferred = peers.find((p) => p.peerId === preferredOriginPeerId)
    if (preferred) {
      ordered.push(preferred)
      seen.add(preferred.peerId)
    }
  }

  for (const peer of gossipPeers) {
    if (seen.has(peer.peerId)) continue
    ordered.push(peer)
    seen.add(peer.peerId)
  }

  for (const peer of peers) {
    if (seen.has(peer.peerId)) continue
    ordered.push(peer)
    seen.add(peer.peerId)
  }

  return ordered
}

export function rankDownloadSources(
  peers: PeerInfo[],
  store: UpdateAvailabilityStore,
  manifest: ReleaseManifest,
  artifact: ArtifactEntry,
  primarySource?: UpdateSourceCandidate
): UpdateSourceCandidate[] {
  const gossipMatches = store
    .listMatching(manifest.manifestId, artifact.sha256)
    .sort(compareAvailability)

  const candidates: UpdateSourceCandidate[] = []
  const seen = new Set<string>()

  const addCandidate = (peer: PeerInfo, entry?: CachedAvailability) => {
    if (seen.has(peer.peerId)) return
    seen.add(peer.peerId)
    candidates.push({
      peerId: peer.peerId,
      nickname: peer.nickname,
      ip: peer.ip,
      discoveryPort: peer.discoveryPort,
      role: entry?.payload.role ?? 'origin',
      activeServes: entry?.payload.activeServes ?? 0,
    })
  }

  if (primarySource) {
    const peer = peers.find((p) => p.peerId === primarySource.peerId)
    if (peer) addCandidate(peer, gossipMatches.find((g) => g.peerId === peer.peerId))
  }

  for (const entry of gossipMatches) {
    const peer = peers.find((p) => p.peerId === entry.peerId)
    if (peer) addCandidate(peer, entry)
  }

  for (const peer of peers) {
    addCandidate(peer)
  }

  return candidates.sort((a, b) => compareCandidate(a, b))
}

function compareAvailability(a: CachedAvailability, b: CachedAvailability): number {
  const roleDiff = roleScore(a.payload.role) - roleScore(b.payload.role)
  if (roleDiff !== 0) return roleDiff

  const servesDiff = (a.payload.activeServes ?? 0) - (b.payload.activeServes ?? 0)
  if (servesDiff !== 0) return servesDiff

  const versionDiff = compareSemver(b.payload.version, a.payload.version)
  if (versionDiff !== 0) return versionDiff

  return a.peerId.localeCompare(b.peerId)
}

function compareCandidate(a: UpdateSourceCandidate, b: UpdateSourceCandidate): number {
  const roleDiff = roleScore(a.role) - roleScore(b.role)
  if (roleDiff !== 0) return roleDiff
  return (a.activeServes ?? 0) - (b.activeServes ?? 0)
}

function roleScore(role: 'origin' | 'mirror'): number {
  return role === 'mirror' ? 0 : 1
}
