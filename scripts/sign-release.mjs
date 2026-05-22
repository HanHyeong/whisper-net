#!/usr/bin/env node
/**
 * Whisper Net LAN release pack signer.
 * Usage: node scripts/sign-release.mjs --version 1.9.0 --artifacts-dir ./dist --out ./release-pack
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function canonicalJson(value) {
  return JSON.stringify(sortValue(value))
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    const sorted = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortValue(value[key])
    }
    return sorted
  }
  return value
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function signJson(obj, privateKey) {
  const bytes = Buffer.from(canonicalJson(obj), 'utf8')
  return crypto.sign(null, bytes, privateKey).toString('base64')
}

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i]
    if (!key.startsWith('--')) continue
    const name = key.slice(2)
    const value = argv[i + 1]
    args[name] = value
    i++
  }
  return args
}

function loadPrivateKey(keyPath) {
  const pem = fs.readFileSync(keyPath, 'utf8')
  return crypto.createPrivateKey(pem)
}

function ensureKey(keyPath) {
  if (fs.existsSync(keyPath)) {
    return loadPrivateKey(keyPath)
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  fs.mkdirSync(path.dirname(keyPath), { recursive: true })
  fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
  const pubDer = publicKey.export({ type: 'spki', format: 'der' })
  console.log('Created new Ed25519 key pair.')
  console.log('Add this public key (DER base64) to src/main/update/trustedKeys.ts:')
  console.log(pubDer.toString('base64'))
  return privateKey
}

function findArtifacts(artifactsDir) {
  const patterns = [
    { platform: 'darwin', arch: 'arm64', ext: '.dmg' },
    { platform: 'darwin', arch: 'x64', ext: '.dmg' },
    { platform: 'win32', arch: 'x64', ext: '.exe' },
    { platform: 'linux', arch: 'x64', ext: '.AppImage' },
  ]
  const files = fs.readdirSync(artifactsDir)
  const artifacts = []
  for (const p of patterns) {
    const match = files.find((f) => f.endsWith(p.ext) && f.includes('Whisper'))
    if (!match) continue
    const full = path.join(artifactsDir, match)
    const stat = fs.statSync(full)
    artifacts.push({
      platform: p.platform,
      arch: p.arch,
      fileName: match,
      fullPath: full,
      size: stat.size,
      sha256: sha256File(full),
      relativePath: `artifacts/${p.platform}-${p.arch}/${match}`,
    })
  }
  return artifacts
}

const args = parseArgs(process.argv)
const version = args.version
const channel = args.channel || 'stable'
const artifactsDir = args['artifacts-dir'] || path.join(__dirname, '../dist')
const outDir = args.out || path.join(__dirname, '../release-pack')
const keyPath = args.key || path.join(process.env.HOME || '', '.whisper-net', 'release.key')
const publisherKeyId = args['key-id'] || 'whisper-net-dev'
const minAppVersion = args['min-app-version'] || '1.8.0'
const releaseNotes = args.notes || `Release ${version}`

if (!version) {
  console.error('Usage: node scripts/sign-release.mjs --version 1.9.0 [--artifacts-dir dist] [--out release-pack]')
  process.exit(1)
}

const privateKey = ensureKey(keyPath)
const artifactEntries = findArtifacts(artifactsDir)
if (artifactEntries.length === 0) {
  console.error(`No artifacts found in ${artifactsDir}. Run npm run dist first.`)
  process.exit(1)
}

const manifestId = crypto.randomUUID()
const manifest = {
  schema: 1,
  manifestId,
  version,
  channel,
  releasedAt: new Date().toISOString(),
  minAppVersion,
  publisherKeyId,
  releaseNotes,
  artifacts: artifactEntries.map(({ platform, arch, relativePath, fileName, size, sha256 }) => ({
    platform,
    arch,
    relativePath,
    fileName,
    size,
    sha256,
  })),
}

const manifestFileName = `release-${version}.manifest.json`
const verifiedRoot = path.join(outDir, '_whisper-updates', 'verified')
const manifestsDir = path.join(verifiedRoot, 'manifests')
const channelsDir = path.join(verifiedRoot, 'channels')

fs.mkdirSync(manifestsDir, { recursive: true })
fs.mkdirSync(channelsDir, { recursive: true })

const manifestPath = path.join(manifestsDir, manifestFileName)
fs.writeFileSync(manifestPath, `${canonicalJson(manifest)}\n`)
fs.writeFileSync(`${manifestPath}.sig`, signJson(manifest, privateKey))

const channelPointer = {
  schema: 1,
  channel,
  version,
  manifestId,
  manifestPath: `manifests/${manifestFileName}`,
  manifestSigPath: `manifests/${manifestFileName}.sig`,
  updatedAt: new Date().toISOString(),
  publisherKeyId,
}

const channelPath = path.join(channelsDir, `${channel}.json`)
fs.writeFileSync(channelPath, `${canonicalJson(channelPointer)}\n`)
fs.writeFileSync(`${channelPath}.sig`, signJson(channelPointer, privateKey))

for (const artifact of artifactEntries) {
  const destDir = path.join(verifiedRoot, path.dirname(artifact.relativePath))
  fs.mkdirSync(destDir, { recursive: true })
  fs.copyFileSync(artifact.fullPath, path.join(verifiedRoot, artifact.relativePath))
}

console.log(`Release pack written to ${verifiedRoot}`)
console.log(`  Channel: ${channel} → ${version}`)
console.log(`  Artifacts: ${artifactEntries.length}`)
console.log('')
console.log('Deploy: copy release-pack/_whisper-updates/verified/ to IT PC shared folder:')
console.log('  {sharedPath}/_whisper-updates/verified/')
