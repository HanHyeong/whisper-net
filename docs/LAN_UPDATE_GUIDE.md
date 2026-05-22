# LAN 업데이트 가이드

> Whisper Net **v1.10.0+** — 사무실 LAN에서 서명·검증된 설치 파일을 배포하는 방법  
> **설계 상세**: [LAN_UPDATE_SYSTEM.md](./LAN_UPDATE_SYSTEM.md)

---

## 1. 개요

Whisper Net은 **인터넷 없이** 같은 LAN에서 업데이트를 받을 수 있습니다.

| 역할 | 누가 | 하는 일 |
|------|------|---------|
| **Publisher** | 개발/IT (릴리스 담당) | 설치 파일 빌드 → manifest 서명 → LAN 밖에서 private key 보관 |
| **Origin** | IT PC 1대 | 서명된 릴리스 팩을 **공유폴더**에 배치 |
| **Mirror** | 업데이트를 받은 PC | 검증 완료 후 다른 PC에 **미러로 재배포** (Phase 2) |
| **Client** | 일반 사용자 | Sidebar에서 확인 → 다운로드 → **수동 설치** |

> ⚠️ **OS 코드 서명(Gatekeeper / SmartScreen)은 지원하지 않습니다.**  
> 다운로드 후 사용자가 설치 파일을 직접 실행해야 합니다. 자동 무인 설치는 없습니다.

---

## 2. 사전 요구사항

### IT / Publisher

- Node.js 20+, `npm run dist`로 설치 파일 생성 가능한 환경
- **Ed25519 private key** — LAN·NAS·공유폴더에 **절대 두지 않음**  
  기본 경로: `~/.whisper-net/release.key` (`sign-release` 실행 시 없으면 자동 생성)
- IT Origin PC: Whisper Net 실행 + **공유폴더** 설정

### Client

- 같은 LAN에 연결 (mDNS 또는 수동 IP 연결)
- Origin PC 또는 Mirror PC와 **피어 연결** 상태
- 앱 버전 **1.9.0 이상** (LAN 업데이트 기능 포함)

---

## 3. IT: 릴리스 만들기

### 3.1 설치 파일 빌드

```bash
cd whisper-net
npm install
npm run dist
```

플랫폼별 출력 (`dist/`):

| OS | 파일 예시 |
|----|-----------|
| macOS (Apple Silicon) | `Whisper Net-1.10.0-arm64.dmg` |
| macOS (Intel) | `Whisper Net-1.10.0.dmg` |
| Windows | `Whisper Net Setup 1.10.0.exe` |
| Linux | `Whisper Net-1.10.0.AppImage` |

### 3.2 릴리스 팩 서명

```bash
npm run sign-release -- \
  --version 1.10.0 \
  --artifacts-dir ./dist \
  --out ./release-pack
```

주요 옵션:

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--version` | (필수) | 릴리스 버전 |
| `--artifacts-dir` | `./dist` | `npm run dist` 출력 폴더 |
| `--out` | `./release-pack` | 서명된 팩 출력 폴더 |
| `--key` | `~/.whisper-net/release.key` | Ed25519 private key (PEM) |
| `--key-id` | `whisper-net-dev` | manifest의 `publisherKeyId` |
| `--channel` | `stable` | `stable` 또는 `beta` |
| `--min-app-version` | `1.8.0` | 이 버전 미만 클라이언트는 업데이트 거부 |
| `--notes` | `Release {version}` | 릴리스 노트 (UpdateModal에 표시) |

**최초 실행 시** 새 키 쌍이 생성되면 터미널에 **public key (base64)** 가 출력됩니다.  
앱에 내장된 키와 다르면 `src/main/update/trustedKeys.ts`에 추가하거나, `whisper-config.json`의 `update.trustedPublisherKeys`에 등록해야 클라이언트가 서명을 신뢰합니다.

생성 결과:

```
release-pack/
└── _whisper-updates/
    └── verified/
        ├── channels/
        │   ├── stable.json
        │   └── stable.json.sig
        ├── manifests/
        │   ├── release-1.10.0.manifest.json
        │   └── release-1.10.0.manifest.json.sig
        └── artifacts/
            ├── darwin-arm64/Whisper Net-1.10.0-arm64.dmg
            ├── win32-x64/Whisper Net Setup 1.10.0.exe
            └── ...
```

---

## 4. IT: Origin 배포

### 4.1 공유폴더에 복사

IT PC의 공유폴더(`sharedPath`) 아래에 **verified 폴더 전체**를 그대로 복사합니다.

```
{sharedPath}/
└── _whisper-updates/
    └── verified/          ← release-pack 내용을 여기에
        ├── channels/
        ├── manifests/
        └── artifacts/
```

예 (macOS):

```bash
cp -R release-pack/_whisper-updates/verified/ \
  "/Users/it/Documents/SharedFolder/_whisper-updates/verified/"
```

> `_whisper-updates`는 공유폴더 브라우저 UI에서 **숨겨집니다**. 일반 사용자가 실수로 삭제하지 않도록 IT만 관리하세요.

### 4.2 Origin PC 설정

1. Whisper Net 실행
2. Sidebar → **Shared Folder** ON → 위 `{sharedPath}` 선택
3. LAN에 다른 PC가 연결되면 Origin이 채널·manifest·설치 파일을 HTTP로 제공

Origin 확인 (다른 PC 또는 curl):

```bash
curl "http://{ORIGIN_IP}:8080/whisper/share/_whisper-updates/verified/channels/stable.json"
```

---

## 5. 사용자: 업데이트 받기

### 5.1 UI에서 확인

1. Whisper Net 실행 (LAN 연결)
2. Sidebar 하단 **버전 번호** (예: `v1.9.1`) 클릭
3. **확인** → LAN에서 새 버전 검색
4. **다운로드** → manifest 서명 + SHA-256 검증 후 로컬 저장
5. **설치 파일 열기** → OS 설치 마법사/앱 설치 진행

자동 알림: 앱 시작 약 30초 후, 이후 **6시간마다** 백그라운드 확인 (`update:available` push).

### 5.2 설치 시 OS 경고

| OS | 안내 |
|----|------|
| **macOS** | Gatekeeper 경고 → Finder에서 **우클릭 → 열기** |
| **Windows** | SmartScreen → **추가 정보 → 실행** |
| **Linux** | `.AppImage` 실행 권한 부여 후 실행 |

UpdateModal 하단에도 동일 안내가 표시됩니다.

### 5.3 미러에서 받기 (Phase 2)

여러 PC가 동시에 업데이트할 때:

1. **첫 번째 PC**가 Origin에서 다운로드·검증
2. 검증 완료 PC가 **Mirror**로 동작 → `update_availability` gossip
3. **다음 PC**는 Mirror 우선 다운로드 (Origin 부하 분산)
4. Mirror가 바쁘면(동시 serve 한도) **503** → 다른 Mirror/Origin으로 자동 fallback

사용자는 UI가 동일합니다. 출처 피어 이름만 Sidebar 모달에 표시됩니다.

---

## 6. 설정 (`whisper-config.json`)

경로:

- macOS: `~/Library/Application Support/whisper-net/whisper-config.json`
- Windows: `%APPDATA%/whisper-net/whisper-config.json`
- Linux: `~/.config/whisper-net/whisper-config.json`

```json
{
  "nickname": "사용자",
  "sharedPath": "/path/to/shared",
  "update": {
    "channel": "stable",
    "checkOnStartup": true,
    "checkIntervalHours": 6,
    "mirrorEnabled": true,
    "maxConcurrentServes": 2,
    "preferredOriginPeerId": "optional-it-peer-uuid",
    "trustedPublisherKeys": {
      "whisper-net-main-2026": "MCowBQYDK2VwAyEA..."
    }
  }
}
```

| 필드 | 기본값 | 설명 |
|------|--------|------|
| `channel` | `stable` | 확인할 채널 |
| `checkOnStartup` | `true` | 시작 후 자동 확인 |
| `checkIntervalHours` | `6` | 주기적 확인 간격 |
| `mirrorEnabled` | `true` | 다운로드·검증 후 Mirror 광고/serve |
| `maxConcurrentServes` | `2` | Mirror가 동시에 제공하는 artifact 수 |
| `preferredOriginPeerId` | — | IT Origin 피어 UUID (probe 우선) |
| `trustedPublisherKeys` | — | 추가 publisher 공개키 (keyId → base64) |

---

## 7. 개발 모드

개발 빌드(`npm run dev`)에서는 LAN 업데이트가 **기본 비활성**입니다.

테스트 시:

```bash
WHISPER_ENABLE_UPDATE=1 npm run dev
```

E2E(`WHISPER_E2E=1`)에서는 업데이트 네트워크가 항상 꺼집니다.

---

## 8. 문제 해결

| 증상 | 확인 사항 |
|------|-----------|
| **연결된 피어가 없습니다** | 같은 LAN, mDNS/수동 연결, Origin Shared Folder ON |
| **업데이트 확인이 비활성** | dev 모드 → `WHISPER_ENABLE_UPDATE=1` |
| **서명 검증 실패** | `publisherKeyId`가 `trustedKeys.ts` 또는 config에 등록됐는지 |
| **최신 버전입니다** (새 버전 있는데) | Origin `channels/stable.json` 버전·경로 확인 |
| **다운로드 실패** | Origin/Mirror HTTP(8080~8083), 방화벽, artifact 경로 |
| **Mirror busy (503)** | `maxConcurrentServes` 초과 — 잠시 후 재시도 또는 다른 Mirror |
| **플랫폼 artifact 없음** | `sign-release`에 해당 OS 설치 파일 포함 여부 |
| **구버전 설치 파일 남음** | v1.9.1+ 자동 정리 — verified/incoming에서 최신 1세트만 유지 |

### 수동 HTTP 확인

```bash
# 채널 포인터
curl "http://{IP}:8080/whisper/share/_whisper-updates/verified/channels/stable.json"

# 미러 메타 (Phase 2)
curl "http://{IP}:8080/whisper/update-info"

# incoming 경로 차단 확인 (403 기대)
curl -I "http://{IP}:8080/whisper/share/_whisper-updates/incoming/test.exe"
```

---

## 9. 보안 체크리스트 (IT)

- [ ] Private key는 `~/.whisper-net/` 등 **LAN 밖**에만 보관
- [ ] 공유폴더에는 `verified/` **서명 완료본만** 배치
- [ ] `incoming/`·`state.json`은 HTTP로 노출되지 않음 (403)
- [ ] 릴리스마다 `npm run sign-release`로 manifest·해시 재생성
- [ ] 사용자에게 **공식 Sidebar 경로**로만 업데이트 안내 (임의 exe 실행 금지)

---

## 10. 관련 문서

| 문서 | 내용 |
|------|------|
| [LAN_UPDATE_SYSTEM.md](./LAN_UPDATE_SYSTEM.md) | 아키텍처·프로토콜·보안 설계 |
| [CHANGELOG.md](../CHANGELOG.md) | 버전별 변경 이력 |
| [AGENTS.md](../AGENTS.md) | 개발자 레퍼런스 |

---

## 11. 빠른 참조 (한 페이지)

```
[Publisher — LAN 밖]
  npm run dist
  npm run sign-release -- --version X.Y.Z --artifacts-dir ./dist --out ./release-pack

[Origin — IT PC]
  cp -R release-pack/_whisper-updates/verified/ → {sharedPath}/_whisper-updates/verified/
  Whisper Net → Shared Folder ON

[Client — 모든 사용자]
  Sidebar vX.Y.Z 클릭 → 확인 → 다운로드 → 설치 파일 열기
```
