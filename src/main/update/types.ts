export type UpdateChannel = 'stable' | 'beta'

export type VerifyErrorCode =
  | 'bad_signature'
  | 'bad_hash'
  | 'bad_size'
  | 'downgrade'
  | 'unknown_key'
  | 'schema'
  | 'not_found'
  | 'platform'

export interface VerifyResult {
  ok: boolean
  error?: VerifyErrorCode
  message?: string
}

export interface ArtifactEntry {
  platform: string
  arch: string
  relativePath: string
  fileName: string
  size: number
  sha256: string
}

export interface ReleaseManifest {
  schema: number
  manifestId: string
  version: string
  channel: UpdateChannel
  releasedAt: string
  minAppVersion: string
  publisherKeyId: string
  releaseNotes: string
  artifacts: ArtifactEntry[]
}

export interface ChannelPointer {
  schema: number
  channel: UpdateChannel
  version: string
  manifestId: string
  manifestPath: string
  manifestSigPath: string
  updatedAt: string
  publisherKeyId: string
}

export interface UpdateAvailabilityPayload {
  channel: UpdateChannel
  version: string
  manifestId: string
  publisherKeyId: string
  platform: string
  arch: string
  artifactSha256: string
  artifactSize: number
  role: 'origin' | 'mirror'
  manifestRelativePath: string
  manifestSigRelativePath: string
  artifactRelativePath: string
  activeServes?: number
}

export interface UpdateSourceCandidate {
  peerId: string
  nickname: string
  ip: string
  discoveryPort: number
  role: 'origin' | 'mirror'
  activeServes: number
}

export interface MirrorStatus {
  enabled: boolean
  role: 'origin' | 'mirror' | null
  availability: UpdateAvailabilityPayload | null
  activeServes: number
  maxConcurrentServes: number
}

export interface UpdateCheckResult {
  status: 'up_to_date' | 'available' | 'error'
  currentVersion: string
  channel: UpdateChannel
  manifest?: ReleaseManifest
  artifact?: ArtifactEntry
  source?: { peerId: string; nickname: string; ip: string; discoveryPort: number; role?: 'origin' | 'mirror' }
  mirrorCount?: number
  error?: VerifyErrorCode
  message?: string
}

export interface UpdateDownloadResult {
  ok: boolean
  manifestId?: string
  version?: string
  installerPath?: string
  error?: VerifyErrorCode
  message?: string
}

export interface UpdateProgress {
  phase: 'downloading' | 'verifying' | 'ready' | 'error'
  percent: number
  message?: string
}

export interface UpdateSettings {
  channel: UpdateChannel
  checkOnStartup: boolean
  checkIntervalHours: number
  mirrorEnabled: boolean
  maxConcurrentServes: number
  preferredOriginPeerId?: string
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  channel: 'stable',
  checkOnStartup: true,
  checkIntervalHours: 6,
  mirrorEnabled: true,
  maxConcurrentServes: 2,
}
