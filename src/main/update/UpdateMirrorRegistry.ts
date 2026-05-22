import fs from 'fs'
import path from 'path'
import { UPDATE_VERIFIED_PREFIX } from './paths'
import { ArtifactEntry, ReleaseManifest, UpdateAvailabilityPayload, UpdateSettings } from './types'

export interface UpdateMirrorRegistryDeps {
  getVerifiedDir: () => string
  getSharedPath: () => string | null
  getSettings: () => UpdateSettings
  getPlatformArch: () => { platform: string; arch: string }
}

export class UpdateMirrorRegistry {
  private localAvailability: UpdateAvailabilityPayload | null = null
  private activeServes = 0

  constructor(private deps: UpdateMirrorRegistryDeps) {}

  scanLocal() {
    const verifiedDir = this.deps.getVerifiedDir()
    const manifestsDir = path.join(verifiedDir, 'manifests')
    if (!fs.existsSync(manifestsDir)) {
      this.localAvailability = null
      return
    }

    const manifestFiles = fs
      .readdirSync(manifestsDir)
      .filter((name) => name.endsWith('.manifest.json'))
      .sort()
      .reverse()

    for (const fileName of manifestFiles) {
      const manifestPath = path.join(manifestsDir, fileName)
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ReleaseManifest
        const artifact = this.pickLocalArtifact(manifest, verifiedDir)
        if (artifact) {
          this.localAvailability = this.buildPayload(manifest, artifact)
          return
        }
      } catch {
        continue
      }
    }
    this.localAvailability = null
  }

  registerAfterDownload(manifest: ReleaseManifest, artifact: ArtifactEntry) {
    this.localAvailability = this.buildPayload(manifest, artifact)
  }

  canSendAvailability(): boolean {
    const settings = this.deps.getSettings()
    return settings.mirrorEnabled && this.localAvailability !== null
  }

  getLocalAvailability(): UpdateAvailabilityPayload | null {
    if (!this.canSendAvailability()) return null
    return {
      ...this.localAvailability!,
      activeServes: this.activeServes,
    }
  }

  getActiveServes(): number {
    return this.activeServes
  }

  getMirrorStatus(): {
    enabled: boolean
    role: 'origin' | 'mirror' | null
    availability: UpdateAvailabilityPayload | null
    activeServes: number
    maxConcurrentServes: number
  } {
    const settings = this.deps.getSettings()
    return {
      enabled: settings.mirrorEnabled,
      role: this.localAvailability?.role ?? null,
      availability: this.getLocalAvailability(),
      activeServes: this.activeServes,
      maxConcurrentServes: settings.maxConcurrentServes,
    }
  }

  tryBeginServe(relativePath: string): boolean {
    if (!relativePath.includes('/artifacts/')) return true
    if (!this.resolveUpdateShareFile(relativePath)) return false

    const role = this.localAvailability?.role ?? this.detectRoleFromShared()
    if (role === 'mirror' && !this.deps.getSettings().mirrorEnabled) return false

    const settings = this.deps.getSettings()
    if (this.activeServes >= settings.maxConcurrentServes) return false
    this.activeServes++
    return true
  }

  endServe() {
    if (this.activeServes > 0) this.activeServes--
  }

  resolveUpdateShareFile(relativePath: string): string | null {
    const normalized = relativePath.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!normalized.startsWith(`${UPDATE_VERIFIED_PREFIX}/`)) return null

    const verifiedDir = path.resolve(this.deps.getVerifiedDir())
    const suffix = normalized.slice(`${UPDATE_VERIFIED_PREFIX}/`.length)
    const filePath = path.resolve(path.join(verifiedDir, suffix))
    if (!isPathInside(filePath, verifiedDir)) return null
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null
    return filePath
  }

  private buildPayload(manifest: ReleaseManifest, artifact: ArtifactEntry): UpdateAvailabilityPayload {
    const manifestFileName = `release-${manifest.version}.manifest.json`
    return {
      channel: manifest.channel,
      version: manifest.version,
      manifestId: manifest.manifestId,
      publisherKeyId: manifest.publisherKeyId,
      platform: artifact.platform,
      arch: artifact.arch,
      artifactSha256: artifact.sha256,
      artifactSize: artifact.size,
      role: this.detectRoleFromShared(),
      manifestRelativePath: `manifests/${manifestFileName}`,
      manifestSigRelativePath: `manifests/${manifestFileName}.sig`,
      artifactRelativePath: artifact.relativePath,
    }
  }

  private detectRoleFromShared(): 'origin' | 'mirror' {
    const shared = this.deps.getSharedPath()
    if (!shared) return 'mirror'
    const channelsDir = path.join(shared, '_whisper-updates', 'verified', 'channels')
    if (!fs.existsSync(channelsDir)) return 'mirror'
    const hasChannel = fs.readdirSync(channelsDir).some((name) => name.endsWith('.json') && !name.endsWith('.sig'))
    return hasChannel ? 'origin' : 'mirror'
  }

  private pickLocalArtifact(manifest: ReleaseManifest, verifiedDir: string): ArtifactEntry | null {
    const { platform, arch } = this.deps.getPlatformArch()
    const artifact =
      manifest.artifacts.find((a) => a.platform === platform && a.arch === arch) ??
      manifest.artifacts.find((a) => a.platform === platform)
    if (!artifact) return null

    const filePath = path.join(verifiedDir, artifact.relativePath)
    if (!fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    if (stat.size !== artifact.size) return null
    return artifact
  }
}

function isPathInside(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
