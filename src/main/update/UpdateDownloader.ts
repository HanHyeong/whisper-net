import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { downloadBinary } from '../utils/http'
import { UPDATE_INCOMING_DIR, UPDATE_VERIFIED_DIR, UPDATE_VERIFIED_PREFIX } from './paths'
import { cleanIncomingDir, pruneVerifiedUpdates } from './cleanup'
import { UpdateVerifier } from './UpdateVerifier'
import { ArtifactEntry, ReleaseManifest, UpdateDownloadResult, UpdateProgress } from './types'

export interface UpdateDownloaderDeps {
  getSharedPath: () => string | null
  verifier: UpdateVerifier
  onProgress?: (progress: UpdateProgress) => void
}

export class UpdateDownloader {
  constructor(private deps: UpdateDownloaderDeps) {}

  getUpdateBasePath(): string {
    const shared = this.deps.getSharedPath()
    if (shared) {
      return path.join(shared, '_whisper-updates')
    }
    return path.join(app.getPath('userData'), 'whisper-updates-cache')
  }

  getVerifiedDir(): string {
    return path.join(this.getUpdateBasePath(), UPDATE_VERIFIED_DIR)
  }

  getIncomingDir(): string {
    return path.join(this.getUpdateBasePath(), UPDATE_INCOMING_DIR)
  }

  async downloadFromPeer(
    ip: string,
    discoveryPort: number,
    manifest: ReleaseManifest,
    artifact: ArtifactEntry
  ): Promise<UpdateDownloadResult> {
    this.ensureDirs()
    const incomingRoot = this.getIncomingDir()
    const verifiedRoot = this.getVerifiedDir()

    try {
      this.emitProgress('downloading', 0, '매니페스트 다운로드 중…')
      await this.downloadManifestBundle(ip, discoveryPort, manifest, incomingRoot)

      const artifactSharePath = `${UPDATE_VERIFIED_PREFIX}/${artifact.relativePath}`
      const incomingArtifact = path.join(incomingRoot, artifact.relativePath)
      fs.mkdirSync(path.dirname(incomingArtifact), { recursive: true })

      this.emitProgress('downloading', 10, '설치 파일 다운로드 중…')
      await downloadBinary(
        this.shareUrl(ip, discoveryPort, artifactSharePath),
        incomingArtifact,
        (received, total) => {
          const base = 10
          const span = 70
          const pct = total > 0 ? base + Math.floor((received / total) * span) : base
          this.emitProgress('downloading', pct, '설치 파일 다운로드 중…')
        }
      )

      this.emitProgress('verifying', 85, '무결성 검증 중…')
      const verifyResult = await this.deps.verifier.verifyArtifactFile(incomingArtifact, artifact)
      if (!verifyResult.ok) {
        fs.rmSync(incomingArtifact, { force: true })
        this.emitProgress('error', 0, verifyResult.message)
        return { ok: false, error: verifyResult.error, message: verifyResult.message }
      }

      const verifiedArtifact = path.join(verifiedRoot, artifact.relativePath)
      fs.mkdirSync(path.dirname(verifiedArtifact), { recursive: true })
      fs.renameSync(incomingArtifact, verifiedArtifact)

      pruneVerifiedUpdates(verifiedRoot, manifest, artifact)
      cleanIncomingDir(incomingRoot)

      this.emitProgress('ready', 100, '다운로드 및 검증 완료')
      return {
        ok: true,
        manifestId: manifest.manifestId,
        version: manifest.version,
        installerPath: verifiedArtifact,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '다운로드 실패'
      this.emitProgress('error', 0, message)
      return { ok: false, error: 'not_found', message }
    }
  }

  findLocalInstaller(manifestId: string, artifact: ArtifactEntry): string | null {
    const verifiedArtifact = path.join(this.getVerifiedDir(), artifact.relativePath)
    if (!fs.existsSync(verifiedArtifact)) return null
    return verifiedArtifact
  }

  private async downloadManifestBundle(
    ip: string,
    discoveryPort: number,
    manifest: ReleaseManifest,
    incomingRoot: string
  ) {
    const manifestFileName = `release-${manifest.version}.manifest.json`
    const manifestShare = `${UPDATE_VERIFIED_PREFIX}/manifests/${manifestFileName}`
    const sigShare = `${manifestShare}.sig`

    const manifestDest = path.join(incomingRoot, 'manifests', manifestFileName)
    const sigDest = `${manifestDest}.sig`
    fs.mkdirSync(path.dirname(manifestDest), { recursive: true })

    await downloadBinary(this.shareUrl(ip, discoveryPort, manifestShare), manifestDest)
    await downloadBinary(this.shareUrl(ip, discoveryPort, sigShare), sigDest)

    const jsonText = fs.readFileSync(manifestDest, 'utf8')
    const sigText = fs.readFileSync(sigDest, 'utf8').trim()
    const verified = this.deps.verifier.verifyManifest(jsonText, sigText)
    if (!verified.ok || !verified.data) {
      throw new Error(verified.message ?? 'manifest 검증 실패')
    }

    const verifiedManifestDir = path.join(this.getVerifiedDir(), 'manifests')
    fs.mkdirSync(verifiedManifestDir, { recursive: true })
    fs.copyFileSync(manifestDest, path.join(verifiedManifestDir, manifestFileName))
    fs.copyFileSync(sigDest, path.join(verifiedManifestDir, `${manifestFileName}.sig`))
  }

  private shareUrl(ip: string, port: number, relativePath: string): string {
    const encoded = relativePath.split('/').map(encodeURIComponent).join('/')
    return `http://${ip}:${port}/whisper/share/${encoded}`
  }

  private ensureDirs() {
    fs.mkdirSync(this.getIncomingDir(), { recursive: true })
    fs.mkdirSync(this.getVerifiedDir(), { recursive: true })
  }

  private emitProgress(phase: UpdateProgress['phase'], percent: number, message?: string) {
    this.deps.onProgress?.({ phase, percent, message })
  }
}
