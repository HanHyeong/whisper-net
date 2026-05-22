# Electron 데스크톱 앱 UI 검수 자동화 가이드

> Whisper Net Phase 6에서 실제로 적용한 방식을 정리한 문서입니다.  
> **다른 Electron/React 프로젝트에 그대로 옮겨 쓸 수 있도록** 설계 패턴 중심으로 작성했습니다.

---

## 1. 이게 “화면 검수”인가?

AI가 스크린샷을 보고 판단하는 방식이 **아닙니다.**

**Playwright**가 실제 앱 창을 띄운 뒤, 사람이 QA할 때와 같은 동작(클릭, 입력, 목록 확인)을 자동으로 수행하고, **화면에 기대한 UI가 나타났는지** assertion으로 검증합니다.

| 사람 QA | Playwright E2E |
|---------|----------------|
| 앱 실행 | `electron.launch()` |
| “PeerA” 닉네임 입력 | `page.fill()`, `page.click()` |
| Discovered Rooms에 방 이름 보이는지 확인 | `expect(page.getByText(...)).toBeVisible()` |
| B가 보낸 메시지가 A 화면에 보이는지 확인 | `expect(a.page.getByText(message)).toBeVisible()` |

즉 **“실제 UI를 띄워서 end-to-end로 검수하는 자동화”**입니다.  
Electron + React 앱에 특히 잘 맞고, Whisper Net처럼 **두 클라이언트가 서로 통신**하는 경우에도 같은 패턴으로 확장할 수 있습니다.

---

## 2. 전체 구조

```
┌─────────────────────────────────────────────────────────────┐
│  Playwright Test Runner (Node.js)                           │
│  tests/e2e/*.spec.ts                                        │
└───────────────┬─────────────────────────┬───────────────────┘
                │                         │
        electron.launch(A)          electron.launch(B)
        WHISPER_E2E=1               WHISPER_E2E=1
        --user-data-dir=/tmp/a      --user-data-dir=/tmp/b
                │                         │
                ▼                         ▼
┌───────────────────────┐     ┌───────────────────────┐
│  Electron Instance A  │◄───►│  Electron Instance B  │
│  (Main + Renderer)    │ TCP │  (Main + Renderer)    │
│  React UI             │ mDNS│  React UI             │
└───────────────────────┘     └───────────────────────┘
                ▲                         ▲
                │   page.click/fill/expect │
                └──────── Playwright Page ──┘
```

**핵심 아이디어 3가지**

1. **빌드된 앱을 실행** — `out/main/index.js` (dev 서버 localhost:5173에 의존하지 않음)
2. **인스턴스 분리** — `--user-data-dir`로 설정·닉네임·상태 충돌 방지
3. **E2E 전용 모드** — DevTools/트레이/창 숨김 등 테스트를 방해하는 동작 비활성화

---

## 3. Whisper Net에서 한 일 (파일 맵)

| 파일 | 역할 |
|------|------|
| `tests/e2e/helpers/electron-app.ts` | 앱 launch/종료, 공통 UI 조작 헬퍼 |
| `tests/e2e/app.spec.ts` | 스모크 (앱 실행, 닉네임) |
| `tests/e2e/room-discovery.spec.ts` | 2인스턴스 시나리오 (방 발견·join·메시지) |
| `playwright.config.ts` | workers=1, serial, timeout 120s |
| `src/main/index.ts` | `WHISPER_E2E=1` 처리 |
| `tests/scenarios/room-discovery.md` | 수동 QA 시나리오 (E2E와 1:1 대응) |

**실행**

```bash
npm run build
npm run test:e2e
```

---

## 4. 가장 중요한 패턴: E2E 전용 모드

Electron 앱을 Playwright로 그냥 실행하면 흔히 막히는 지점이 있습니다.

| 문제 | 원인 |
|------|------|
| 화면이 비어 있음 | `!app.isPackaged` → dev 모드로 `localhost:5173` 로드 (dev 서버 없음) |
| `firstWindow()`가 DevTools | dev 모드에서 DevTools가 먼저 열림 |
| 테스트 후 프로세스 안 죽음 | 트레이 앱이라 `close` 시 hide만 하고 quit 안 함 |

**해결: 환경 변수 하나로 테스트 모드 분기**

```typescript
// src/main/index.ts (개념)
const isE2E = process.env.WHISPER_E2E === '1'
const isDev = !app.isPackaged && !isE2E

if (isDev) {
  win.loadURL('http://localhost:5173')
  win.webContents.openDevTools()
} else {
  win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

// E2E에서는 트레이·창 hide 비활성
if (!isE2E) createTray(...)
win.on('close', (e) => { if (!isQuitting && !isE2E) { e.preventDefault(); win.hide() } })
app.on('window-all-closed', () => { if (isE2E) app.quit() })
```

Playwright launch 시:

```typescript
await electron.launch({
  args: [mainPath, `--user-data-dir=${userDataDir}`],
  env: { ...process.env, WHISPER_E2E: '1' },
})
```

> **다른 프로젝트 적용 시**: `MYAPP_E2E=1`, `CI=1` 등 이름은 자유.  
> “테스트일 때 dev URL/DevTools/트레이/단일 인스턴스 잠금”을 끄는 것이 목표입니다.

---

## 5. 앱 launch / 종료 헬퍼

### 5.1 Launch

```typescript
import { _electron as electron } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

const MAIN_PATH = path.join(__dirname, '../../../out/main/index.js')

export async function launchWhisperApp(instanceId: string) {
  // 인스턴스마다 별도 userData → 닉네임·config 충돌 방지
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `whisper-e2e-${instanceId}-`))

  const app = await electron.launch({
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, WHISPER_E2E: '1' },
  })

  // DevTools 창 제외하고 실제 앱 window만 잡기
  const page = await app.waitForEvent('window', {
    predicate: async (w) => {
      const url = w.url()
      return !url.startsWith('devtools://') && url !== 'about:blank'
    },
    timeout: 30_000,
  })
  await page.waitForLoadState('domcontentloaded')

  return { app, page, userDataDir }
}
```

### 5.2 종료 (트레이 앱 필수)

`app.close()`만 호출하면 트레이 때문에 프로세스가 120초 이상 남을 수 있습니다.

```typescript
export async function closeWhisperApp(app, userDataDir) {
  try {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0))
  } catch { /* already closed */ }
  await app.close().catch(() => {})
  fs.rmSync(userDataDir, { recursive: true, force: true })
}
```

테스트 본문은 **항상 `try/finally`로 종료 보장**:

```typescript
const a = await launchWhisperApp('a1')
try {
  // ... 검수 시나리오
} finally {
  await closeWhisperApp(a.app, a.userDataDir)
}
```

---

## 6. UI를 “사람처럼” 조작하고 검증하기

Playwright locator 우선순위 (유지보수성):

1. **`getByRole`** — `button`, `heading` (접근성 이름)
2. **`getByPlaceholder`** — 입력 필드
3. **`getByTitle`** — 아이콘 버튼 (Whisper Net의 🔄, + 등)
4. **`locator` + 텍스트/CSS** — 마지막 수단

**예: 방 생성 → 상대 화면에서 확인**

```typescript
// A: UI로 방 생성
await a.page.getByRole('button', { name: '+ New Room' }).click()
await a.page.locator('input').first().fill(roomName)
await a.page.getByRole('button', { name: '만들기' }).click()

// B: Discovered Rooms에 표시되는지 검수
await expect(b.page.getByText('Discovered Rooms')).toBeVisible({ timeout: 30_000 })
await expect(
  b.page.locator('aside li').filter({ hasText: roomName }).filter({ hasText: 'Join' })
).toBeVisible()

// B: join 후 채팅 화면 진입 확인
await b.page.locator('aside li').filter({ hasText: roomName }).click()
await expect(b.page.getByRole('heading', { name: roomName })).toBeVisible()

// B → A 메시지 전달 검수
const message = `hello-${Date.now()}`
await b.page.getByPlaceholder('메시지를 입력하세요...').fill(message)
await b.page.getByRole('button', { name: '전송' }).click()
await expect(a.page.getByText(message)).toBeVisible({ timeout: 20_000 })
```

**포인트**

- `Date.now()`로 room/message 이름을 유unique하게 → 테스트 간 간섭 감소
- 네트워크 동기화는 **즉시 안 될 수 있음** → `timeout: 20_000~30_000` 여유
- assertion은 “API 응답”이 아니라 **“사용자가 보는 화면”** 기준

---

## 7. 2인스턴스(멀티 클라이언트) 테스트

LAN/P2P/채팅 앱은 **클라이언트 2개**를 동시에 띄워야 합니다.

```typescript
test.describe.configure({ mode: 'serial' }) // 같은 worker에서 순차 실행

test('A creates room → B discovers', async () => {
  const a = await launchWhisperApp('a1')
  const b = await launchWhisperApp('b1')
  try {
    await ensureNickname(a.page, 'PeerA')
    await ensureNickname(b.page, 'PeerB')
    await ensurePeersConnected(a.page, b.page, 'PeerA', 'PeerB')
    // ...
  } finally {
    await closeWhisperApp(a.app, a.userDataDir)
    await closeWhisperApp(b.app, b.userDataDir)
  }
})
```

**Playwright 설정**

```typescript
// playwright.config.ts
export default defineConfig({
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
})
```

`workers: 1` — Electron/multiple instance 테스트는 병렬보다 **한 worker에서 serial**이 안전합니다.

### 네트워크 flakiness 대응

mDNS는 환경에 따라 느리거나 실패합니다. Whisper Net 패턴:

```typescript
async function ensurePeersConnected(pageA, pageB, nameA, nameB) {
  try {
    await waitForPeer(pageB, nameA, 12_000) // mDNS 먼저 시도
  } catch {
    const addr = await getLocalAddress(pageA) // UI에서 IP:port 읽기
    await manualConnect(pageB, addr.ip, addr.port) // 수동 연결 fallback
    await waitForPeer(pageB, nameA, 20_000)
  }
  await waitForPeer(pageA, nameB, 20_000)
}
```

**교훈**: E2E는 “happy path 한 가지”만 두지 말고, **실제 사용자 fallback(수동 연결, refresh)** 도 시나리오에 포함하면 CI/로컬 모두 안정적입니다.

---

## 8. 헬퍼 레이어로 테스트 읽기 쉽게

시나리오 파일(`*.spec.ts`)은 **Given-When-Then**만 남기고, UI 디테일은 헬퍼로 숨깁니다.

```
tests/e2e/
├── helpers/
│   └── electron-app.ts    ← launch, nickname, createRoom, join, ...
├── app.spec.ts            ← 스모크
└── room-discovery.spec.ts ← 시나리오 (읽기 쉬운 스토리)
```

**좋은 spec 예**

```typescript
await ensurePeersConnected(a.page, b.page, 'PeerA', 'PeerB')
await createPublicRoom(a.page, roomName)
await waitForDiscoveredRoom(b.page, roomName)
await joinDiscoveredPublicRoom(b.page, roomName)
```

QA 담당자도 “무엇을 검수하는지” spec만 읽고 이해할 수 있습니다.

---

## 9. 다른 프로젝트에 옮기는 체크리스트

### Electron + React (Whisper Net과 동일 계열)

- [ ] `@playwright/test` devDependency 추가
- [ ] `playwright.config.ts` — `workers: 1`, 충분한 `timeout`
- [ ] Main 프로세스에 **E2E 모드** 분기 (`loadFile`, DevTools off, tray off, quit on close)
- [ ] `npm run build` 후 `out/main/index.js` (또는 빌드 산출물) 경로 확인
- [ ] `helpers/electron-app.ts` — launch/close + `--user-data-dir`
- [ ] 스모크 1개: 앱 뜨고 타이틀/핵심 UI visible
- [ ] 핵심 user journey 1개: “기능 A → UI 반영 → 기능 B에서 확인”
- [ ] 멀티 인스턴스 필요 시 serial + 인스턴스별 userDataDir
- [ ] `npm run test:e2e` 스크립트 추가

### 일반 웹 앱 (Next.js, Vite SPA 등)

Electron launch 대신:

```typescript
import { test, expect } from '@playwright/test'

test('로그인 후 대시보드', async ({ page }) => {
  await page.goto('http://localhost:3000')
  await page.getByLabel('이메일').fill('user@test.com')
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible()
})
```

웹은 `webServer` 옵션으로 dev 서버 자동 기동:

```typescript
// playwright.config.ts
webServer: { command: 'npm run dev', url: 'http://localhost:3000' }
```

### 모바일/네이티브

Playwright는 **Chromium/Firefox/WebKit + Electron** 중심입니다.  
React Native, Flutter 등은 Detox, Maestro, Appium 등 별도 스택을 검토하세요.

---

## 10. 디버깅 팁

| 증상 | 확인 |
|------|------|
| 테스트가 2분 타임아웃 | `app.close()` hang → `app.exit(0)` 추가 |
| Whisper Net 텍스트 안 보임 | DevTools 창을 잡고 있는지 → `waitForEvent('window')` predicate |
| 간헐적 실패 | timeout 늘리기, fallback 시나리오 추가, `Date.now()` unique 이름 |
| 실패 원인 분석 | `trace: 'on-first-retry'`, 실패 시 `test-results/` 스크린샷 |

**헤드풀(창 보이며) 실행**

```bash
npx playwright test tests/e2e/room-discovery.spec.ts --headed
```

로컬에서 “진짜 화면 띄워지는지” 눈으로 확인할 때 유용합니다.

**단일 테스트만**

```bash
npx playwright test -g "Discovered Rooms"
```

---

## 11. 수동 QA와 E2E의 관계

Whisper Net은 두 문서를 **쌍**으로 유지합니다.

| 문서 | 용도 |
|------|------|
| `tests/scenarios/room-discovery.md` | 사람이 따라 할 수 있는 체크리스트 |
| `tests/e2e/room-discovery.spec.ts` | 같은 시나리오의 자동 검수 |

새 기능 추가 시:

1. 시나리오 md에 “사람 QA 단계” 작성
2. spec에 동일 흐름 automation
3. 회귀는 `npm run test:e2e` 한 번으로

---

## 12. Whisper Net Phase 6에서 검수한 시나리오

| # | 시나리오 | 검증 내용 |
|---|----------|-----------|
| 1 | A 선행 방 생성 | B Discovered Rooms → join → 메시지 A 화면 표시 |
| 2 | B 선행 | A가 나중에 방 생성해도 B에 표시 |
| 3 | 수동 IP 연결 | mDNS 없이 Manual Connect 후 방 목록 |
| 4 | 🔄 refresh | refreshPeers fallback |
| 5 | 비밀방 | 잘못된 비밀번호 알림, 올바른 비밀번호 join |

현재 **7 tests, ~15초** (로컬 macOS 기준).

---

## 13. 한 줄 요약

> **Playwright로 실제 Electron 창을 띄우고, 사용자 행동을 흉내 낸 뒤, 화면에 기대 UI가 나타나는지 assert한다.**  
> 테스트 안정성은 **E2E 전용 모드 + user-data-dir 분리 + 확실한 프로세스 종료 + 네트워크 fallback**에서 나온다.

다른 프로젝트에서는 `WHISPER_E2E` → `{YOUR_APP}_E2E`, `launchWhisperApp` → `launchApp`만 바꿔도 같은 골격으로 UI 검수 자동화를 시작할 수 있습니다.

---

*관련: [E2E_EXISTING_ELECTRON_PROJECTS.md](./E2E_EXISTING_ELECTRON_PROJECTS.md) (기존 Electron 적용·필수/선택 작업), [REFACTORING_PLAN.md](../REFACTORING_PLAN.md) Phase 6, [tests/scenarios/room-discovery.md](../tests/scenarios/room-discovery.md), [AGENTS.md](../AGENTS.md) §7 테스트*
