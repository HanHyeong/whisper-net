import fs from 'fs'
import path from 'path'
import { ArtifactEntry, ReleaseManifest } from './types'

/** 검증 완료 후 이전 릴리스 manifest·artifact·incoming 잔여물 제거 */
export function pruneVerifiedUpdates(
  verifiedRoot: string,
  manifest: ReleaseManifest,
  artifact: ArtifactEntry
): void {
  pruneManifests(path.join(verifiedRoot, 'manifests'), manifest.version)
  pruneArtifactTree(verifiedRoot, artifact)
}

export function cleanIncomingDir(incomingRoot: string): void {
  if (!fs.existsSync(incomingRoot)) return
  fs.rmSync(incomingRoot, { recursive: true, force: true })
}

function pruneManifests(manifestsDir: string, keepVersion: string) {
  if (!fs.existsSync(manifestsDir)) return

  const keepJson = `release-${keepVersion}.manifest.json`
  const keepSig = `${keepJson}.sig`

  for (const name of fs.readdirSync(manifestsDir)) {
    if (name === keepJson || name === keepSig) continue
    if (!name.startsWith('release-')) continue
    if (!name.endsWith('.manifest.json') && !name.endsWith('.manifest.json.sig')) continue
    fs.rmSync(path.join(manifestsDir, name), { force: true })
  }
}

function pruneArtifactTree(verifiedRoot: string, artifact: ArtifactEntry) {
  const artifactsRoot = path.join(verifiedRoot, 'artifacts')
  const keepDir = path.join(verifiedRoot, path.dirname(artifact.relativePath))
  const keepFile = path.join(keepDir, artifact.fileName)

  if (fs.existsSync(keepDir)) {
    for (const name of fs.readdirSync(keepDir)) {
      const full = path.join(keepDir, name)
      if (path.resolve(full) === path.resolve(keepFile)) continue
      if (fs.statSync(full).isFile()) {
        fs.rmSync(full, { force: true })
      }
    }
  }

  if (!fs.existsSync(artifactsRoot)) return

  for (const name of fs.readdirSync(artifactsRoot)) {
    const full = path.join(artifactsRoot, name)
    if (!fs.statSync(full).isDirectory()) {
      fs.rmSync(full, { force: true })
      continue
    }
    if (path.resolve(full) === path.resolve(keepDir)) continue
    fs.rmSync(full, { recursive: true, force: true })
  }
}
