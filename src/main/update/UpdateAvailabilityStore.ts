import { compareSemver } from './semver'
import { UpdateAvailabilityPayload, UpdateChannel } from './types'

export interface CachedAvailability {
  peerId: string
  payload: UpdateAvailabilityPayload
  receivedAt: number
}

const DEFAULT_STALE_MS = 60 * 60 * 1000

export class UpdateAvailabilityStore {
  private entries = new Map<string, CachedAvailability>()

  upsert(peerId: string, payload: UpdateAvailabilityPayload) {
    if (!isValidPayload(payload)) return
    this.entries.set(peerId, { peerId, payload, receivedAt: Date.now() })
  }

  remove(peerId: string) {
    this.entries.delete(peerId)
  }

  get(peerId: string): UpdateAvailabilityPayload | null {
    return this.entries.get(peerId)?.payload ?? null
  }

  listForChannel(channel: UpdateChannel, minVersion?: string): CachedAvailability[] {
    this.pruneStale()
    const out: CachedAvailability[] = []
    for (const entry of this.entries.values()) {
      if (entry.payload.channel !== channel) continue
      if (minVersion && compareSemver(entry.payload.version, minVersion) <= 0) continue
      out.push(entry)
    }
    return out
  }

  listMatching(manifestId: string, artifactSha256: string): CachedAvailability[] {
    this.pruneStale()
    const out: CachedAvailability[] = []
    for (const entry of this.entries.values()) {
      const p = entry.payload
      if (p.manifestId === manifestId && p.artifactSha256 === artifactSha256) {
        out.push(entry)
      }
    }
    return out
  }

  pruneStale(maxAgeMs = DEFAULT_STALE_MS) {
    const cutoff = Date.now() - maxAgeMs
    for (const [peerId, entry] of this.entries) {
      if (entry.receivedAt < cutoff) {
        this.entries.delete(peerId)
      }
    }
  }
}

function isValidPayload(payload: UpdateAvailabilityPayload): boolean {
  return Boolean(
    payload.channel &&
      payload.version &&
      payload.manifestId &&
      payload.artifactSha256 &&
      payload.manifestRelativePath &&
      payload.manifestSigRelativePath &&
      payload.artifactRelativePath &&
      (payload.role === 'origin' || payload.role === 'mirror')
  )
}
