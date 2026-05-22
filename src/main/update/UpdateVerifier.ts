import fs from 'fs'
import { importPublicKeyBase64, sha256File, verifyCanonicalJson } from './crypto'
import { compareSemver } from './semver'
import { TRUSTED_PUBLISHER_KEYS } from './trustedKeys'
import {
  ArtifactEntry,
  ChannelPointer,
  ReleaseManifest,
  VerifyErrorCode,
  VerifyResult,
} from './types'

export class UpdateVerifier {
  constructor(
    private currentAppVersion: string,
    private extraTrustedKeys: Record<string, string> = {}
  ) {}

  resolvePublicKey(keyId: string) {
    const base64 = TRUSTED_PUBLISHER_KEYS[keyId] ?? this.extraTrustedKeys[keyId]
    if (!base64) return null
    try {
      return importPublicKeyBase64(base64)
    } catch {
      return null
    }
  }

  verifySignedJson<T extends object>(
    jsonText: string,
    signatureBase64: string,
    publisherKeyId: string | undefined,
    validate: (parsed: unknown) => T | null
  ): VerifyResult & { data?: T } {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      return { ok: false, error: 'schema', message: 'JSON 파싱 실패' }
    }

    const data = validate(parsed)
    if (!data) {
      return { ok: false, error: 'schema', message: '스키마 검증 실패' }
    }

    const keyId = publisherKeyId ?? (data as { publisherKeyId?: string }).publisherKeyId
    if (!keyId) {
      return { ok: false, error: 'unknown_key', message: 'publisherKeyId 없음' }
    }

    const publicKey = this.resolvePublicKey(keyId)
    if (!publicKey) {
      return { ok: false, error: 'unknown_key', message: `신뢰하지 않는 키: ${keyId}` }
    }

    if (!verifyCanonicalJson(parsed, signatureBase64, publicKey)) {
      return { ok: false, error: 'bad_signature', message: '서명 검증 실패' }
    }

    return { ok: true, data }
  }

  verifyChannelPointer(jsonText: string, signatureBase64: string): VerifyResult & { data?: ChannelPointer } {
    return this.verifySignedJson(jsonText, signatureBase64, undefined, parseChannelPointer)
  }

  verifyManifest(jsonText: string, signatureBase64: string): VerifyResult & { data?: ReleaseManifest } {
    const result = this.verifySignedJson(jsonText, signatureBase64, undefined, parseManifest)
    if (!result.ok || !result.data) return result

    const manifest = result.data
    if (compareSemver(this.currentAppVersion, manifest.minAppVersion) < 0) {
      return {
        ok: false,
        error: 'downgrade',
        message: `현재 버전(${this.currentAppVersion})이 최소 요구(${manifest.minAppVersion})보다 낮습니다.`,
      }
    }

    return result
  }

  isNewerVersion(version: string): boolean {
    return compareSemver(version, this.currentAppVersion) > 0
  }

  pickArtifact(manifest: ReleaseManifest): VerifyResult & { artifact?: ArtifactEntry } {
    const platform = process.platform
    const arch = process.arch
    const artifact = manifest.artifacts.find((a) => a.platform === platform && a.arch === arch)
    if (!artifact) {
      return {
        ok: false,
        error: 'platform',
        message: `${platform}/${arch}용 설치 파일이 없습니다.`,
      }
    }
    return { ok: true, artifact }
  }

  async verifyArtifactFile(filePath: string, artifact: ArtifactEntry): Promise<VerifyResult> {
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'not_found', message: '파일을 찾을 수 없습니다.' }
    }

    const stat = fs.statSync(filePath)
    if (stat.size !== artifact.size) {
      return { ok: false, error: 'bad_size', message: '파일 크기가 일치하지 않습니다.' }
    }

    const hash = await sha256File(filePath)
    if (hash.toLowerCase() !== artifact.sha256.toLowerCase()) {
      return { ok: false, error: 'bad_hash', message: 'SHA-256 해시가 일치하지 않습니다.' }
    }

    return { ok: true }
  }

  validateChannelManifestConsistency(pointer: ChannelPointer, manifest: ReleaseManifest): VerifyResult {
    if (pointer.manifestId !== manifest.manifestId) {
      return { ok: false, error: 'schema', message: 'manifestId 불일치' }
    }
    if (pointer.version !== manifest.version) {
      return { ok: false, error: 'schema', message: 'version 불일치' }
    }
    if (pointer.channel !== manifest.channel) {
      return { ok: false, error: 'schema', message: 'channel 불일치' }
    }
    return { ok: true }
  }
}

function parseChannelPointer(value: unknown): ChannelPointer | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (o.schema !== 1) return null
  if (typeof o.channel !== 'string') return null
  if (typeof o.version !== 'string') return null
  if (typeof o.manifestId !== 'string') return null
  if (typeof o.manifestPath !== 'string') return null
  if (typeof o.manifestSigPath !== 'string') return null
  if (typeof o.updatedAt !== 'string') return null
  if (typeof o.publisherKeyId !== 'string') return null
  return {
    schema: 1,
    channel: o.channel as ChannelPointer['channel'],
    version: o.version,
    manifestId: o.manifestId,
    manifestPath: o.manifestPath,
    manifestSigPath: o.manifestSigPath,
    updatedAt: o.updatedAt,
    publisherKeyId: o.publisherKeyId,
  }
}

function parseManifest(value: unknown): ReleaseManifest | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (o.schema !== 1) return null
  if (typeof o.manifestId !== 'string') return null
  if (typeof o.version !== 'string') return null
  if (typeof o.channel !== 'string') return null
  if (typeof o.releasedAt !== 'string') return null
  if (typeof o.minAppVersion !== 'string') return null
  if (typeof o.publisherKeyId !== 'string') return null
  if (typeof o.releaseNotes !== 'string') return null
  if (!Array.isArray(o.artifacts)) return null

  const artifacts: ArtifactEntry[] = []
  for (const item of o.artifacts) {
    const parsed = parseArtifact(item)
    if (!parsed) return null
    artifacts.push(parsed)
  }

  const seen = new Set<string>()
  for (const a of artifacts) {
    const key = `${a.platform}:${a.arch}`
    if (seen.has(key)) return null
    seen.add(key)
  }

  return {
    schema: 1,
    manifestId: o.manifestId,
    version: o.version,
    channel: o.channel as ReleaseManifest['channel'],
    releasedAt: o.releasedAt,
    minAppVersion: o.minAppVersion,
    publisherKeyId: o.publisherKeyId,
    releaseNotes: o.releaseNotes,
    artifacts,
  }
}

function parseArtifact(value: unknown): ArtifactEntry | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (typeof o.platform !== 'string') return null
  if (typeof o.arch !== 'string') return null
  if (typeof o.relativePath !== 'string') return null
  if (typeof o.fileName !== 'string') return null
  if (typeof o.size !== 'number' || o.size < 0) return null
  if (typeof o.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(o.sha256)) return null
  return {
    platform: o.platform,
    arch: o.arch,
    relativePath: o.relativePath.replace(/\\/g, '/'),
    fileName: o.fileName,
    size: o.size,
    sha256: o.sha256.toLowerCase(),
  }
}

export type { VerifyErrorCode }
