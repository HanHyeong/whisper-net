# LAN 업데이트 시스템 설계서

> **대상 버전**: 1.10.0  
> **목적**: 전자서명(Apple/Microsoft 코드 서명) 없이, **공유폴더 + P2P 미러** 기반 LAN 업데이트 배포  
> **상태**: Phase 2 구현 완료 (2026-05-22)  
> **관련 문서**: [PROJECT_MAPPING.md](../PROJECT_MAPPING.md), [AGENTS.md](../AGENTS.md), **[LAN_UPDATE_GUIDE.md](./LAN_UPDATE_GUIDE.md)** (배포·사용 가이드)

---

## 1. 배경 및 목표

### 1.1 문제

| 제약 | 설명 |
|------|------|
| **OS 코드 서명 불가** | macOS Gatekeeper / Windows SmartScreen 우회 불가 → **자동 설치·자동 교체** 불가 |
| **인터넷 의존 회피** | Whisper Net은 LAN P2P 메신저 → 사무실 내부 배포 선호 |
| **Origin 단일 PC 부하** | IT PC 1대 공유폴더만 쓰면 대용량 설치 파일(100MB+) 다운로드 시 **네트워크 병목** |
| **변조 전파 위험** | 공유폴더·HTTP·미러 경로를 통한 **악성 바이너리 LAN 전파** 반드시 차단 |

### 1.2 목표 (한 줄)

> **릴리스 Ed25519 서명 manifest + SHA-256 무결성 검증**으로 변조를 막고,  
> **검증 완료 PC만 미러(Seeder)로 동작**해 Origin 부하를 분산하며,  
> **사용자 확인 후 설치 파일 실행** UX를 제공한다.

### 1.3 비목표 (Out of Scope)

- OS 수준 **무인 자동 설치** (`electron-updater` silent install)
- **인터넷** GitHub Releases 자동 배포 (Phase 4+ 별도 옵션)
- **바이너리 코드 서명** (Authenticode / Apple notarization)
- LAN **델타 패치** (bsdiff 등) — Phase 3+ 검토

### 1.4 설계 원칙

| 원칙 | 내용 |
|------|------|
| **Verify-before-trust** | manifest 서명·artifact 해시 검증 **전**에는 미러 광고·재배포 금지 |
| **Verify-before-serve** | `verified/` 외 경로는 HTTP share로 **절대 노출하지 않음** |
| **Origin-independent verify** | 미러에서 받아도 Origin과 **동일한 검증 파이프라인** 적용 |
| **Private key off-LAN** | 서명 private key는 LAN·공유폴더·클라이언트에 **절대 배치하지 않음** |
| **Reuse infrastructure** | `/whisper/share`, TCP `file_chunk`, `PeerSyncService`, Path Traversal 방어 재사용 |
| **Graceful degradation** | 서명 실패·해시 불일치 시 **조용히 무시하지 않고** 사용자·로그에 명시 |

---

## 2. 아키텍처 개요

### 2.1 역할

```mermaid
flowchart TB
  subgraph release [릴리스 (LAN 밖)]
    BUILD[npm run dist]
    SIGN[sign-release.js]
    BUILD --> SIGN
  end

  subgraph origin [Origin — IT PC]
    SF["_whisper-updates/verified/"]
    SIGN --> SF
  end

  subgraph lan [LAN]
    M1[Mirror PC 1]
    M2[Mirror PC 2]
    C1[Client A]
    C2[Client B]
  end

  SF -->|HTTP share| C1
  SF -->|HTTP share| M1
  M1 -->|update_availability gossip| C2
  M2 -->|HTTP / TCP| C2
  SF -.->|manifest only| M2
```

| 역할 | 설명 | 검증 후 행동 |
|------|------|-------------|
| **Publisher** | 릴리스 manifest 서명 (private key 보유) | LAN 밖 |
| **Origin** | IT PC 공유폴더에 manifest + sig + artifact 배치 | serve `verified/` |
| **Mirror (Seeder)** | 다운로드·검증 완료 PC | `update_availability` 광고 + serve |
| **Leecher (Client)** | 업데이트 수신 PC | 검증 → (opt-in) 미러 전환 → 설치 안내 |

### 2.2 데이터 흐름 (Client)

```
1. 채널 포인터 fetch (channels/stable.json + sig)
2. 채널 포인터 서명 검증
3. manifest + manifest.sig fetch
4. manifest 서명 검증
5. update_availability 수집 (Origin + Mirrors)
6. 소스 선택 → artifact 다운로드 (HTTP 또는 TCP chunk)
7. SHA-256 + size 검증
8. verified/ 로컬 이동 (미러 opt-in 시)
9. shell.openPath(installer) — 사용자 수동 설치
```

### 2.3 기존 코드 재사용 매핑

| 기존 | 업데이트 용도 |
|------|--------------|
| `TcpDiscovery.handleShareDownload` | manifest·artifact HTTP 다운로드 ( **`verified/` 하위만** ) |
| `utils/http.ts` `downloadBinary` | artifact 수신 |
| `MessageService` `file_offer`/`file_chunk` | 대용량 artifact (Phase 2, 진행률 UI 재사용) |
| `PeerSyncService.refreshPeer` | Origin `/whisper/peers` + share 목록 |
| `protocol.ts` | `update_availability`, `update_manifest` 타입 추가 |
| `path.resolve` Path Traversal 방어 | `_whisper-updates` serve 경로 제한 |

---

## 3. 공유폴더 디렉터리 규약

### 3.1 Origin (IT PC) 레이아웃

```
{sharedPath}/
└── _whisper-updates/
    ├── channels/
    │   ├── stable.json              # 채널 포인터 (서명됨)
    │   └── stable.json.sig
    ├── manifests/
    │   ├── release-1.9.0.manifest.json
    │   └── release-1.9.0.manifest.sig
    └── artifacts/
        ├── darwin-arm64/
        │   └── Whisper Net-1.9.0.dmg
        ├── darwin-x64/
        │   └── Whisper Net-1.9.0.dmg
        ├── win32-x64/
        │   └── Whisper Net Setup 1.9.0.exe
        └── linux-x64/
            └── Whisper Net-1.9.0.AppImage
```

> **Origin도 `artifacts/`를 `verified/` 개념으로 취급** — IT가 배포 전 로컬에서 서명·해시 검증 후 업로드.

### 3.2 Mirror (Client) 로컬 레이아웃

```
{sharedPath}/
└── _whisper-updates/
    ├── incoming/                    # 다운로드 중 (HTTP share 금지)
    ├── verified/                    # 검증 완료만 serve
    │   ├── manifests/
    │   │   ├── release-1.9.0.manifest.json
    │   │   └── release-1.9.0.manifest.sig
    │   └── artifacts/
    │       └── win32-x64/
    │           └── Whisper Net Setup 1.9.0.exe
    └── state.json                   # 로컬 미러 상태 (serve 금지)
```

### 3.3 HTTP 노출 규칙

| 경로 | HTTP share | 비고 |
|------|------------|------|
| `_whisper-updates/incoming/**` | **금지** | 다운로드 중 partial 파일 |
| `_whisper-updates/state.json` | **금지** | 내부 상태 |
| `_whisper-updates/verified/**` | **허용** | manifest + artifact |
| `_whisper-updates/` (그 외) | **금지** | default deny |

**구현**: `TcpDiscovery`에 `_whisper-updates` 전용 allowlist — `verified/` prefix만 `handleShareDownload` 통과.

---

## 4. 매니페스트 및 채널 스키마

### 4.1 Release Manifest (`release-{version}.manifest.json`)

```json
{
  "schema": 1,
  "manifestId": "550e8400-e29b-41d4-a716-446655440000",
  "version": "1.9.0",
  "channel": "stable",
  "releasedAt": "2026-05-22T09:00:00Z",
  "minAppVersion": "1.8.0",
  "publisherKeyId": "whisper-net-main-2026",
  "releaseNotes": "LAN 업데이트 시스템 추가",
  "artifacts": [
    {
      "platform": "darwin",
      "arch": "arm64",
      "relativePath": "artifacts/darwin-arm64/Whisper Net-1.9.0.dmg",
      "fileName": "Whisper Net-1.9.0.dmg",
      "size": 98234567,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "platform": "win32",
      "arch": "x64",
      "relativePath": "artifacts/win32-x64/Whisper Net Setup 1.9.0.exe",
      "fileName": "Whisper Net Setup 1.9.0.exe",
      "size": 87654321,
      "sha256": "abc123..."
    }
  ]
}
```

| 필드 | 필수 | 설명 |
|------|------|------|
| `schema` | Y | 스키마 버전 (현재 `1`) |
| `manifestId` | Y | UUID — 동일 version replay·치환 탐지 |
| `version` | Y | semver |
| `channel` | Y | `stable` \| `beta` |
| `releasedAt` | Y | ISO 8601 UTC |
| `minAppVersion` | Y | 이보다 낮은 클라이언트는 업데이트 **거부** (downgrade 유도 방지) |
| `publisherKeyId` | Y | 서명 키 ID (키 로테이션) |
| `artifacts[]` | Y | 플랫폼별 1개 (중복 platform+arch 금지) |

### 4.2 Channel Pointer (`channels/stable.json`)

```json
{
  "schema": 1,
  "channel": "stable",
  "version": "1.9.0",
  "manifestId": "550e8400-e29b-41d4-a716-446655440000",
  "manifestPath": "manifests/release-1.9.0.manifest.json",
  "manifestSigPath": "manifests/release-1.9.0.manifest.sig",
  "updatedAt": "2026-05-22T09:00:00Z"
}
```

클라이언트는 **먼저 channel pointer → manifest → artifact** 순으로 fetch.

### 4.3 서명 파일 형식 (`.sig`)

```
Base64( Ed25519_sign( SHA-256( canonical_json_bytes ) ) )
```

- **canonical JSON**: 키 알파벳 정렬, UTF-8, trailing newline 없음
- 서명 대상: `.manifest.json` 본문 **전체** (pretty-print 금지 — 릴리스 스크립트가 canonical 출력)
- channel pointer (`stable.json`)도 **동일 방식** 별도 `.sig`

### 4.4 로컬 Mirror State (`state.json`, serve 금지)

```json
{
  "mirrors": [
    {
      "manifestId": "550e8400-e29b-41d4-a716-446655440000",
      "version": "1.9.0",
      "channel": "stable",
      "platform": "win32",
      "arch": "x64",
      "artifactSha256": "abc123...",
      "verifiedAt": "2026-05-22T10:00:00Z",
      "serveEnabled": true,
      "activeDownloads": 0
    }
  ],
  "settings": {
    "mirrorEnabled": true,
    "maxConcurrentServes": 2,
    "maxUploadKbps": 0
  }
}
```

---

## 5. 암호화 및 신뢰 모델

### 5.1 키 관리

| 키 | 위치 | 용도 |
|----|------|------|
| **Publisher Ed25519 private key** | 릴리스 PC only (`~/.whisper-net/release.key`, gitignore) | manifest·channel 서명 |
| **Publisher Ed25519 public key(s)** | 앱 내장 `src/main/update/trustedKeys.ts` | 클라이언트 검증 |
| (선택) **Org 추가 public key** | `whisper-config.json` `trustedPublisherKeys[]` | 다중 릴리스 담당 |

**Private key는 LAN·Origin 공유폴더·NAS·클라이언트에 저장하지 않는다.**

### 5.2 내장 Trust Anchor

```typescript
// src/main/update/trustedKeys.ts
export const TRUSTED_PUBLISHER_KEYS: Record<string, string> = {
  'whisper-net-main-2026': 'BASE64_ED25519_PUBLIC_KEY',
}
```

- `publisherKeyId`가 map에 없으면 **즉시 거부**
- config 추가 키는 내장 키 **이후** 검사 (내장 키 우선)

### 5.3 검증 파이프라인 (`UpdateVerifier`)

```typescript
interface VerifyResult {
  ok: boolean
  error?: 'bad_signature' | 'bad_hash' | 'bad_size' | 'downgrade' | 'unknown_key' | 'schema'
}

class UpdateVerifier {
  verifyChannelPointer(json: string, sigBase64: string): VerifyResult
  verifyManifest(json: string, sigBase64: string): VerifyResult
  verifyArtifact(filePath: string, expected: ArtifactEntry): Promise<VerifyResult>
}
```

**순서 (어느 하나라도 실패 시 중단):**

1. Channel pointer JSON parse + schema
2. Channel pointer Ed25519 verify
3. Manifest JSON parse + schema + `manifestId`/`version` channel pointer와 **일치**
4. Manifest Ed25519 verify + `publisherKeyId` trust
5. `semver(current) >= minAppVersion` (downgrade block)
6. `semver(new) > semver(current)` (동일·낮으면 skip)
7. Artifact download → **size check** → **streaming SHA-256** → hash compare

### 5.4 Canonical JSON (서명 호환)

릴리스 스크립트·클라이언트 **동일 구현** 필수:

```typescript
function canonicalJson(obj: unknown): string {
  // recursive key sort, no undefined, numbers as JSON spec
}
```

**보안 검증 #1**: pretty-printed manifest와 canonical manifest의 서명 불일치 → 릴리스 CI에서 golden test.

---

## 6. P2P 프로토콜 확장

### 6.1 MessageType 추가 (`protocol.ts`)

```typescript
export type MessageType =
  | ... existing ...
  | 'update_availability'
  | 'update_manifest_ad'

export interface UpdateAvailabilityPayload {
  channel: 'stable' | 'beta'
  version: string
  manifestId: string
  publisherKeyId: string
  platform: string
  arch: string
  artifactSha256: string
  artifactSize: number
  role: 'origin' | 'mirror'
  /** HTTP share base: _whisper-updates/verified/ */
  manifestRelativePath: string
  manifestSigRelativePath: string
  artifactRelativePath: string
}

export interface UpdateManifestAdPayload {
  /** 작은 channel pointer JSON (서명은 HTTP로 fetch) */
  channel: 'stable' | 'beta'
  version: string
  manifestId: string
}
```

### 6.2 Gossip 정책

| 메시지 | 발행자 | FANOUT | 조건 |
|--------|--------|--------|------|
| `update_manifest_ad` | Origin (optional) | 3 | channel pointer 로컬 verified |
| `update_availability` | Origin + Mirror | 3 | artifact **로컬 verified** 후만 |

**보안 검증 #2**: `update_availability` 수신만으로는 **신뢰하지 않음** — 항상 HTTP로 manifest fetch + 서명 검증 + artifact hash.

### 6.3 PeerInfo HTTP 확장 (`/whisper/peers`)

```json
{
  "self": {
    "peerId": "...",
    "updateCapabilities": {
      "origin": false,
      "mirror": true,
      "channels": ["stable"]
    }
  }
}
```

`PeerSyncService.refreshPeer` 시 capabilities 반영 (선택, Phase 2).

---

## 7. UpdateService — Main Process 모듈

### 7.1 파일 구조 (신규)

```
src/main/update/
├── trustedKeys.ts          # 내장 Ed25519 public keys
├── canonicalJson.ts        # 서명용 canonical serialization
├── UpdateVerifier.ts       # 서명·해시·semver 검증
├── UpdateSourceSelector.ts # Origin/Mirror 소스 선택·fallback
├── UpdateDownloader.ts     # HTTP + TCP chunk 다운로드
├── UpdateMirrorRegistry.ts # 로컬 verified·serve 상태
├── UpdateService.ts        # 오케스트레이션 (EventEmitter)
└── types.ts                # Manifest, ChannelPointer, MirrorState

scripts/
└── sign-release.ts         # 릴리스 manifest·channel 서명 CLI

src/main/ipc/
└── updateHandlers.ts       # update:* IPC

src/renderer/components/
└── UpdateModal.tsx         # 다운로드·검증·설치 안내 UI
```

### 7.2 UpdateService API

```typescript
class UpdateService extends EventEmitter {
  /** 앱 시작 후 delay, 주기적 check */
  scheduleCheck(options?: { delayMs?: number; intervalMs?: number }): void

  /** 수동 확인 */
  checkForUpdates(channel?: 'stable' | 'beta'): Promise<UpdateCheckResult>

  /** 다운로드 + 검증 */
  downloadUpdate(result: UpdateCheckResult): Promise<UpdateDownloadResult>

  /** verified artifact 경로 → shell.openPath */
  openInstaller(result: UpdateDownloadResult): Promise<void>

  /** 미러 설정 */
  setMirrorEnabled(enabled: boolean): void
  getMirrorStatus(): MirrorStatus

  stop(): void
}
```

### 7.3 소스 선택 알고리즘 (`UpdateSourceSelector`)

```
입력: candidates[] = { peerId, ip, discoveryPort, role, rttMs?, activeDownloads }

1. manifestId + artifactSha256 일치 후보만 필터
2. role=mirror 우선 (Origin 부하 분산), 동률 시:
3. activeDownloads 적은 순
4. rttMs 낮은 순 (Phase 2 ping)
5. 동률 random
6. 순차 fallback: 실패 시 다음 후보 (최대 5회)
```

**보안 검증 #3**: 후보가 100개여도 **각 다운로드 후 hash verify** — 악성 미러는 데이터만 wasted.

### 7.4 미러 Serve 제한

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `mirrorEnabled` | `true` (configurable) | 다운로드·검증 후 자동 미러 |
| `maxConcurrentServes` | `2` | 동시 HTTP artifact serve |
| `maxUploadKbps` | `0` (무제한) | Phase 3 rate limit |

`activeDownloads` 초과 시 HTTP 503 — Leecher는 다른 미러로 fallback.

---

## 8. HTTP API

### 8.1 기존 엔드포인트 활용

| 요청 | 용도 |
|------|------|
| `GET /whisper/share/_whisper-updates/verified/channels/stable.json` | 채널 포인터 |
| `GET /whisper/share/_whisper-updates/verified/manifests/release-1.9.0.manifest.json` | manifest |
| `GET /whisper/share/_whisper-updates/verified/artifacts/.../file.exe` | artifact |

### 8.2 (Phase 2) 전용 메타 엔드포인트

```
GET /whisper/update-info
→ {
    "channels": ["stable"],
    "availability": [ UpdateAvailabilityPayload, ... ]
  }
```

- manifest **본문은 포함하지 않음** (서명 fetch는 share 경로)
- Path Traversal: 기존 `resolveSharePath` 재사용

### 8.3 TcpDiscovery 변경 요약

```typescript
// handleShareDownload 내부
if (relativePath.startsWith('_whisper-updates/')) {
  if (!relativePath.startsWith('_whisper-updates/verified/')) {
    res.writeHead(403); return
  }
  // manifest.sig, .exe 등 allowlist 확장자만
  if (!isAllowedUpdateFile(relativePath)) {
    res.writeHead(403); return
  }
}
```

**허용 확장자**: `.json`, `.sig`, `.dmg`, `.exe`, `.AppImage`

---

## 9. IPC 채널

| 채널 | 방향 | Payload | 설명 |
|------|------|---------|------|
| `update:check` | R→M invoke | `{ channel?: string }` | 업데이트 확인 |
| `update:download` | R→M invoke | `{ manifestId, ... }` | 다운로드 시작 |
| `update:open-installer` | R→M invoke | `{ manifestId }` | 설치 파일 열기 |
| `update:get-settings` | R→M invoke | — | 미러 설정 |
| `update:set-settings` | R→M invoke | `{ mirrorEnabled, ... }` | 미러 설정 |
| `update:progress` | M→R push | `{ phase, percent, ... }` | 진행률 |
| `update:available` | M→R push | `UpdateCheckResult` | 새 버전 알림 |
| `update:error` | M→R push | `{ code, message }` | 검증 실패 |

**E2E / Dev**: `WHISPER_E2E=1` 또는 `isDev` 시 `UpdateService` 비활성.

---

## 10. Renderer UX

### 10.1 UI 위치

| 위치 | 동작 |
|------|------|
| Sidebar 버전 `v1.8.6` 클릭 | UpdateModal 열기 |
| (선택) 트레이 메뉴 | "업데이트 확인" |
| 시작 30s 후 | 백그라운드 check → badge/토스트 |

### 10.2 UpdateModal 상태

```
idle → checking → available | up_to_date
available → downloading → verifying → ready | error
ready → [설치 파일 열기] [나중에]
error → 사유 표시 (bad_signature / bad_hash / …)
```

### 10.3 설치 안내 (OS별, 서명 없음)

| OS | 안내 |
|----|------|
| macOS | "다운로드 후 우클릭 → 열기. 개발자 확인 불가 경고 시 시스템 설정에서 허용." |
| Windows | "SmartScreen 경고 시 '추가 정보' → 실행." |
| Linux | AppImage 실행 권한 안내 |

---

## 11. 릴리스 워크플로

### 11.1 빌드·서명 (LAN 밖)

```bash
npm run dist
node scripts/sign-release.ts \
  --version 1.9.0 \
  --channel stable \
  --artifacts-dir dist/ \
  --key ~/.whisper-net/release.key \
  --out ./release-pack/
```

**산출물 (`release-pack/`):**

```
channels/stable.json (+ .sig)
manifests/release-1.9.0.manifest.json (+ .sig)
artifacts/{platform-arch}/*
```

### 11.2 Origin 배포 (IT)

1. `release-pack/` 내용을 IT PC `{sharedPath}/_whisper-updates/verified/`에 **그대로** 복사
2. Whisper Net 실행 + 공유폴더 ON
3. (선택) `update_manifest_ad` 브로드캐스트 — 또는 클라이언트 주기 check

### 11.3 키 로테이션

1. 새 Ed25519 키 생성 → `publisherKeyId: whisper-net-main-2027`
2. 앱 업데이트에 **새 public key 내장** (구 키 유지 — 구 manifest 검증 가능)
3. N버전 후 구 키 deprecated

---

## 12. 구현 Phase

### Phase 1 — Core Verify + Origin Download (MVP)

| # | 작업 | 파일 |
|---|------|------|
| 1 | `canonicalJson`, `UpdateVerifier` | `src/main/update/*` |
| 2 | `sign-release.ts` | `scripts/` |
| 3 | `UpdateService.checkForUpdates` Origin only | HTTP channel + manifest |
| 4 | `UpdateDownloader` + hash verify | `incoming/` → `verified/` |
| 5 | `TcpDiscovery` `_whisper-updates/verified/` allowlist | `TcpDiscovery.ts` |
| 6 | IPC + UpdateModal (수동 check) | ipc, renderer |
| 7 | Unit test: canonical, sign, verify | `tests/unit/update/` |

**완료 기준**: IT Origin에서 signed update 다운로드·검증·installer open.

### Phase 2 — Mirror + Gossip ✅

| # | 작업 | 상태 |
|---|------|------|
| 1 | `update_availability` protocol + handler | ✅ |
| 2 | `UpdateMirrorRegistry` + serve limits | ✅ |
| 3 | `UpdateSourceSelector` fallback | ✅ |
| 4 | `GET /whisper/update-info` | ✅ |
| 5 | 자동 check 스케줄 + gossip fanout | ✅ |
| 6 | E2E: 3 PC — Origin 1 + Mirror 1 + Leecher 1 | ⏳ (수동 QA) |

### Phase 3 — Hardening

| # | 작업 |
|---|------|
| 1 | TCP chunk 대용량 + 진행률 |
| 2 | `maxUploadKbps`, 503 fallback |
| 3 | beta channel |
| 4 | 감사 로그 (`userData/update-audit.log`) |

---

## 13. 보안 위협 모델 (STRIDE)

### 13.1 위협 목록 및 대응

| ID | 위협 | STRIDE | 공격 시나리오 | 대응 | 잔여 위험 |
|----|------|--------|--------------|------|----------|
| T1 | 공유폴더 artifact 변조 | Tampering | IT NAS 침해, 파일 교체 | manifest Ed25519 + sha256 | **Private key 유출 시** fake release 가능 |
| T2 | Manifest 변조 | Tampering | `stable.json` version bump | channel + manifest **각각** 서명 | 없음 (키 유출 제외) |
| T3 | 가짜 미러 | Spoofing | 공격 PC가 `update_availability` 광고 | 수신 후 **독립 verify** | 대역폭 낭비만 |
| T4 | MITM HTTP 변조 | Tampering | LAN ARP spoofing | sha256 full-file | TLS 미사용 — hash로 완화 |
| T5 | Downgrade | Tampering | old vulnerable version push | `minAppVersion` + `semver(new)>current` | 구버전 앱은 minApp block |
| T6 | Replay old manifest | Repudiation/Replay | 동일 version 재배포 | `manifestId` + `releasedAt` 로깅 | 동일 content replay는 무해 |
| T7 | Path Traversal | Elevation | `../` in share path | `path.resolve` + verified prefix | **구현 필수 테스트** |
| T8 | Partial file serve | Tampering | incoming serve | **incoming HTTP 403** | 구현 누락 시 Critical |
| T9 | Private key on LAN | Info Disclosure | key를 NAS에 업로드 | **정책 + sign-release offline** | 인적 실수 |
| T10 | DoS Origin | DoS | 100대 동시 download | Mirror + concurrent limit | Origin 첫 wave 부하 |
| T11 | 악성 설치 실행 | — | 사용자 social engineering | UI "공식 서명 확인됨" + keyId 표시 | **서명≠코드서명** OS 경고 |
| T12 | TOCTOU | Tampering | download 후 파일 swap | verify 직후 **rename to verified** (atomic) | 같은 FS admin 위협 |
| T13 | Canonical mismatch | Tampering | 다른 JSON formatting | golden test + single lib | 구현 버그 |
| T14 | Wrong platform artifact | — | mac client gets exe | `process.platform` + `arch` match | 사용자 혼동 — UI 표시 |

### 13.2 Critical 제어 (Must-Have)

```
C1. Private key never on LAN
C2. HTTP serve only _whisper-updates/verified/**
C3. verify signature BEFORE hash (fail fast)
C4. verify hash BEFORE mirror advertise
C5. verify hash BEFORE openInstaller
C6. no auto-install / no silent exec
C7. Path Traversal test for all share paths
C8. E2E/dev mode disables update network
```

### 13.3 Phase별 보안 게이트

| Phase | 게이트 (머지 전 필수) |
|-------|----------------------|
| **1** | Unit: sign/verify roundtrip, bad sig, bad hash, downgrade block, path 403 |
| **2** | E2E: rogue mirror wrong hash → reject; 3-node load split |
| **3** | Pen test checklist §13.4 전항목 재검증 |

### 13.4 보안 검증 체크리스트 (릴리스 전)

- [ ] `incoming/` HTTP 403 확인 (curl)
- [ ] `../` traversal 시도 → 403
- [ ] 서명 tamper 1 byte → `bad_signature`
- [ ] artifact tamper → `bad_hash`
- [ ] `minAppVersion` 미달 클라 → 거부
- [ ] 미검증 파일로 `update_availability` send 불가 (unit)
- [ ] Private key repo·sharedPath·NAS 미포함 (grep CI)
- [ ] `WHISPER_E2E=1` update check no-op
- [ ] Mirror 503 시 fallback 동작
- [ ] audit log에 manifestId·result 기록

---

## 14. 테스트 계획

### 14.1 Unit (`tests/unit/update/`)

| 테스트 | 설명 |
|--------|------|
| `canonicalJson.test.ts` | key order, nested, golden vector |
| `UpdateVerifier.test.ts` | valid/invalid sig, hash, size |
| `UpdateSourceSelector.test.ts` | mirror priority, fallback |
| `sharePathGuard.test.ts` | verified-only 403 |

### 14.2 E2E (`tests/e2e/lan-update.spec.ts`)

| 시나리오 | 인스턴스 |
|----------|----------|
| Origin → Client download + verify | 2 |
| Origin → Mirror → Client (Origin HTTP 최소) | 3 |
| Rogue mirror bad hash rejected | 3 |
| Signature tamper rejected | 2 |

### 14.3 수동 QA (`tests/scenarios/lan-update.md`)

- IT Origin 배포 → Client Sidebar check
- Mirror opt-out → Origin only
- macOS/Windows installer open UX

---

## 15. 설정 (`whisper-config.json` 확장)

```typescript
interface WhisperConfig {
  // existing...
  update?: {
    channel: 'stable' | 'beta'
    checkOnStartup: boolean
    checkIntervalHours: number
    mirrorEnabled: boolean
    maxConcurrentServes: number
    trustedPublisherKeys?: Record<string, string>  // keyId → base64 pubkey
    preferredOriginPeerId?: string                 // optional IT peer
  }
}
```

기본값:

```json
{
  "update": {
    "channel": "stable",
    "checkOnStartup": true,
    "checkIntervalHours": 6,
    "mirrorEnabled": true,
    "maxConcurrentServes": 2
  }
}
```

---

## 16. 알려진 한계 (잔여 위험)

| 한계 | 설명 | 수용 근거 |
|------|------|----------|
| **Private key 유출** | 공격자가 legitimate signed malware 배포 | 키 오프라인 보관·로테이션 |
| **LAN MITM without detection** | hash verify 실패 시 사용자 alert | 정상 LAN에서 low risk |
| **사용자가 검증 무시** | unsigned 파일 직접 실행 | UX로 공식 경로 유도 |
| **OS install friction** | Gatekeeper/SmartScreen | 코드 서명 없음 전제 |
| **첫 N대 Origin 부하** | 미러 없을 때 | Phase 2 mitigates |
| **내부자 Publisher** | legitimate key holder 악의적 release | 조직 정책·감사 |

---

## 17. 개발 착수 순서 (Quick Start)

1. `src/main/update/trustedKeys.ts` + test key pair (dev only)
2. `scripts/sign-release.ts` + sample `release-pack/`
3. `UpdateVerifier` unit tests **green**
4. `TcpDiscovery` verified-only guard
5. `UpdateService.checkForUpdates` (Origin HTTP)
6. IPC + Sidebar → UpdateModal
7. Phase 2: `update_availability` + mirror

---

## 18. 문서 유지보수

| 변경 시 | 갱신 대상 |
|---------|----------|
| protocol 타입 추가 | 본 문서 §6, PROJECT_MAPPING.md §8·§9 |
| IPC 추가 | PROJECT_MAPPING.md §8, AGENTS.md |
| 구현 완료 | 본 문서 §12 Phase 상태, CHANGELOG, package.json version |

---

*본 설계서는 구현 중 발견된 보안 이슈에 따라 §13 STRIDE 테이블과 §13.4 체크리스트를 반드시 갱신한다.*
