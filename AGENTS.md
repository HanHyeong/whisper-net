# AGENTS.md — Whisper Net

> AI 코딩 에이전트를 위한 프로젝트 빠른 레퍼런스.  
> **상세 코드 흐름, IPC 완전 맵, 파일별 난이도 분석, 디버깅 가이드는 [PROJECT_MAPPING.md](./PROJECT_MAPPING.md)를 참조하세요.**

---

## 1. 프로젝트 개요

**Whisper Net**은 중앙 서버 없이 동작하는 P2P LAN 메신저 데스크톱 앱입니다. 같은 로컬 네트워크 내 기기들이 mDNS(Bonjour)로 서로를 발견하고, TCP 소켓으로 직접 메시지를 주고받습니다. 메시지는 메모리에만 저장되며 앱 종료 시 삭제됩니다.

- **버전**: 1.3.0
- **라이선스**: MIT
- **메인 엔트리**: `./out/main/index.js` (빌드 후)
- **앱 ID**: `com.whisper-net.app`
- **제품명**: Whisper Net

---

## 2. 기술 스택

| 분야 | 기술 | 버전 | 역할 |
|------|------|------|------|
| 런타임 | Electron | 30.0.8 | Main + Renderer 프로세스 |
| UI 프레임워크 | React | 18.3.1 | 렌더러 UI |
| 언어 | TypeScript | 5.4.5 | 전체 코드베이스 |
| 빌드 도구 | electron-vite | 2.2.0 | Main/Preload/Renderer 3중 빌드 |
| 번들러 | Vite | 5.2.11 | Renderer 번들링 |
| 스타일링 | Tailwind CSS | 3.4.3 | 유틸리티 CSS |
| CSS 후처리 | PostCSS + Autoprefixer | 8.4.38 / 10.4.19 | CSS 처리 |
| 상태 관리 | Zustand | 4.5.2 | 글로벌 클라이언트 상태 |
| P2P 발견 | bonjour-service | 1.3.0 | mDNS 서비스 발견 |
| TCP 통신 | Node.js `net` | 내장 | P2P 메시지 송수신 |
| HTTP 서버 | Node.js `http` | 내장 | 메타데이터 제공 + 파일 서빙 |
| 암호화 | Node.js `crypto` | 내장 | PBKDF2 + AES-256-GCM |
| 테스트 | Playwright | 1.60.0 | E2E 테스트 |
| 패키징 | electron-builder | 24.13.3 | dmg/nsis/AppImage 생성 |

---

## 3. 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: Renderer Process (Chromium)                           │
│  React 18 + Tailwind CSS + Zustand                              │
│  components/: Sidebar, ChatView, SharedFileBrowser, Modals      │
├─────────────────────────────────────────────────────────────────┤
│  IPC Bridge (contextIsolation = true, nodeIntegration = false)  │
│  preload/index.ts → window.whisperAPI 노출                      │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 1: Main Process (Node.js)                                │
│  index.ts → BrowserWindow, IPC 핸들러, 파일전송 상태 관리        │
│  network/ → NetworkManager, DiscoveryManager, TCP/HTTP 서버     │
└─────────────────────────────────────────────────────────────────┘
```

> 상세 아키텍처(3-Layer 다이어그램, 네트워크 프로토콜 스택, Gossip Relay 메커니즘)는 [PROJECT_MAPPING.md §3, §9](./PROJECT_MAPPING.md) 참조.

---

## 4. 디렉토리 구조

```
whisper-net/
├── build/                    # 앱 아이콘 (icon.png, icon.svg)
├── dist/                     # electron-builder 배포 출력
├── out/                      # electron-vite 빌드 출력
│   ├── main/
│   ├── preload/
│   └── renderer/
├── src/
│   ├── main/
│   │   ├── index.ts          # 앱 진입점, 윈도우 생성, 모든 IPC 핸들러
│   │   ├── network/          # NetworkManager, DiscoveryManager, TCP/HTTP, crypto, protocol
│   │   └── utils/
│   │       └── config.ts     # 설정 파일 로드/저장
│   ├── preload/
│   │   └── index.ts          # IPC 브리지 (renderer <-> main)
│   └── renderer/
│       ├── App.tsx           # 메인 레이아웃, 이벤트 구독, 모달 제어
│       ├── main.tsx          # React DOM 진입점
│       ├── index.css         # Tailwind 지시어 + 전역 스타일
│       ├── index.html        # HTML 템플릿 (CSP 포함)
│       ├── stores/
│       │   └── appStore.ts   # Zustand 글로벌 상태
│       └── components/       # Sidebar, ChatView, Modals, SharedFileBrowser
├── tests/e2e/
│   └── app.spec.ts           # Playwright E2E 테스트
├── package.json
├── tsconfig.json
├── electron.vite.config.ts   # Vite 빌드 설정
├── playwright.config.ts      # E2E 테스트 설정
├── postcss.config.js         # PostCSS 설정
├── tailwind.config.js        # Tailwind 설정
└── README.md
```

> 파일별 코드 흐름 상세 분석, IPC 채널 완전 맵, 컴포넌트별 상세 역할은 [PROJECT_MAPPING.md §4~§8](./PROJECT_MAPPING.md) 참조.

---

## 5. 빌드 및 실행 명령

| 명령 | 동작 |
|------|------|
| `npm install` | 의존성 설치 (postinstall로 electron-builder install-app-deps 실행) |
| `npm run dev` | 개발 모드 (HMR, DevTools 자동 열림) |
| `npm run build` | TypeScript 타입 체크 + electron-vite 빌드 → `out/` |
| `npm start` | 빌드 후 Electron 실행 (`out/main/index.js`) |
| `npm run typecheck` | `tsc --noEmit` 타입 검사만 |
| `npm run preview` | electron-vite preview |
| `npm run dist` | 빌드 + electron-builder → `dist/` (dmg/exe/AppImage) |

### 요구사항
- Node.js 20+
- npm
- macOS / Windows / Linux

---

## 6. 코드 스타일 가이드라인

### 6.1 언어 및 주석
- **코드**: TypeScript, ES2022 모듈
- **주석 및 UI 텍스트**: 한국어를 주로 사용 (예: "메시지를 입력하세요...", "복호화 실패")
- **변수/함수명**: camelCase
- **클래스/인터페이스명**: PascalCase
- **상수**: UPPER_SNAKE_CASE (예: `MAX_SEEN_MESSAGES`, `FANOUT`)
- **채널명**: kebab-case (예: `network:message`, `app:get-config`)

### 6.2 Path Alias
`tsconfig.json`과 `electron.vite.config.ts`에 다음 alias가 설정되어 있습니다. 가급적 상대 경로 대신 alias를 사용하세요.

```typescript
import { ... } from '@main/network/NetworkManager'   // src/main/network/...
import { ... } from '@preload/index'                 // src/preload/...
import { ... } from '@renderer/stores/appStore'       // src/renderer/...
```

### 6.3 타입스크립트 규칙
- `strict: true` 활성화
- `noUnusedLocals: false`, `noUnusedParameters: false` — 미사용 변수 경고 없음
- `noFallthroughCasesInSwitch: true`
- `skipLibCheck: true`
- `allowSyntheticDefaultImports: true`, `esModuleInterop: true`

### 6.4 일반적인 코딩 관례
- **메인 프로세스**: EventEmitter 기반 클래스 패턴 (`NetworkManager`, `DiscoveryManager`, `TcpServer`, `TcpClient`)
- **렌더러**: 함수형 React 컴포넌트 + Hooks (useState, useEffect, useRef)
- **상태 관리**: Zustand (`src/renderer/stores/appStore.ts`) — 컴포넌트 로컬 상태와 분리하여 사용
- **IPC**: `ipcMain.handle` / `ipcRenderer.invoke` (요청-응답), `webContents.send` / `ipcRenderer.on` (push)
- **모달 제어**: `App.tsx`가 모든 모달의 표시/숨김 상태를 중앙 관리

---

## 7. 테스트

- **프레임워크**: Playwright (E2E)
- **테스트 파일**: `tests/e2e/app.spec.ts`
- **실행**: `npm run build && npx playwright test`
- **설정**: `fullyParallel: false`, `workers: 1` — Electron 단일 인스턴스 제한

> 상세 테스트 설정 및 수동 테스트 팁은 [PROJECT_MAPPING.md §13](./PROJECT_MAPPING.md) 참조.

---

## 8. 보안 고려사항 요약

| 항목 | 구현 |
|------|------|
| **메시지 저장** | 메모리 only. 앱 종료 시 삭제 |
| **일반방 암호화** | `deriveRoomKey(roomId)` → AES-256-GCM |
| **비밀방 암호화** | `deriveKey(password, roomId)` (PBKDF2 10만 회) → AES-256-GCM |
| **비밀번호 검증** | SHA-256 해시 비교. 네트워크에는 해시만 전송 |
| **공유 폴터 접근** | `path.resolve()` 기반 Path Traversal 방지 |
| **파일 첨부 제한** | 10MB 초과 시 dialog 차단 |
| **Electron 보안** | `contextIsolation: true`, `nodeIntegration: false`, preload 브리지 |
| **CSP** | `index.html`에 Content-Security-Policy 메타 태그 설정 |

> 상세 보안 모델 및 Path Traversal 방지 로직은 [PROJECT_MAPPING.md §11](./PROJECT_MAPPING.md) 참조.

---

## 9. 설정 파일

- **경로**: `app.getPath('userData')/whisper-config.json`
  - macOS: `~/Library/Application Support/whisper-net/whisper-config.json`
- **필드**: `nickname` (string), `sharedPath` (string)
- **API**: `src/main/utils/config.ts`의 `loadConfig()`, `saveConfig(partial)`

---

## 10. 신규 개발 & 디버깅 — 상세 가이드 위임

아래 주제의 **상세 절차, 데이터 흐름 다이어그램, 버그 수정 우선 참조 표**는 모두 [PROJECT_MAPPING.md](./PROJECT_MAPPING.md)에 있습니다.

| 주제 | PROJECT_MAPPING.md 참조 위치 |
|------|------------------------------|
| 새 메시지 타입 추가 | §14.1 |
| 새 네트워크 발견 방식 추가 | §14.2 |
| UI 컴포넌트 수정/추가 | §14.3 |
| 암호화 방식 변경 | §14.4 |
| 빌드/배포 설정 변경 | §14.5 |
| 버그 수정 우선 참조 (증상→의심 파일→원인) | §14.6 |
| 텍스트 메시지 전송 흐름 다이어그램 | §15.1 |
| 피어 발견 흐름 다이어그램 | §15.2 |
| IPC 채널 완전 맵 (R→M / M→R) | §8 |
| 네트워크 프로토콜 상세 (TCP 포맷, Gossip, 방 참여) | §9 |
| 파일 전송 흐름 (대화방 첨부 / 1:1 TCP) | §10 |

---

## 11. 배포

`npm run dist` 실행 시 플랫폼별 패키지가 `dist/`에 생성됩니다.

- **macOS**: `dist/Whisper Net-1.3.0.dmg`
- **Windows**: `dist/Whisper Net Setup 1.3.0.exe`
- **Linux**: `dist/Whisper Net-1.3.0.AppImage`

빌드 설정은 `package.json`의 `build` 필드에서 관리합니다. 아이콘은 `build/icon.png`를 사용합니다.

---

*이 문서는 코드나 프로젝트 구조가 변경될 때 함께 업데이트되어야 합니다.*  
*⚠️ 코드/구조 변경 시 반드시 [PROJECT_MAPPING.md](./PROJECT_MAPPING.md)도 함께 업데이트하세요. 두 문서는 쌍을 이루며, AGENTS.md를 수정했다면 PROJECT_MAPPING.md의 해당 섹션(아키텍처, 디렉토리 구조, IPC 맵, 개발 가이드 등)도 동기화해야 합니다.*
