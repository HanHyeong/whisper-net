# 기존 Electron 프로젝트에 UI 검수 자동화 적용하기

> Whisper Net E2E(Playwright) 경험을 바탕으로, **이미 만들어진 Electron 앱**에 검수 자동화를 붙일 때 필요한 작업을 정리한 문서입니다.  
> 기술 상세·코드 예시는 [E2E_VISUAL_REVIEW_AUTOMATION.md](./E2E_VISUAL_REVIEW_AUTOMATION.md)를 함께 참고하세요.

---

## 1. 한 줄 결론

**기존 Electron 프로젝트에도 적용할 수 있습니다.**

다만 다음을 구분해야 합니다.

| 구분 | 필요 여부 |
|------|-----------|
| Playwright + 테스트 코드 추가 | **필수** |
| 앱에 E2E 모드 분기 (`MYAPP_E2E=1` 등) | **강력 권장** (실무상 거의 필수) |
| UI에 `data-testid` 추가 | **선택** (있으면 유지보수 쉬움) |
| 테스트 전용 API·IPC 신규 개발 | **보통 불필요** (UI로 검수하는 것이 목적) |

“개발할 때부터 E2E 전용 기능을 크게 넣어야 한다”기보다, **테스트 인프라 + Main 프로세스 E2E 모드 분기** 정도면 대부분 커버됩니다.

---

## 2. 바로 적용 가능한 것

Playwright는 **이미 빌드된 Electron 앱**을 그대로 실행할 수 있습니다.

```typescript
await electron.launch({
  args: [pathToMainJs, '--user-data-dir=/tmp/myapp-e2e-1'],
  env: { ...process.env, MYAPP_E2E: '1' },
})
```

이후 `page.click()`, `page.fill()`, `expect(...).toBeVisible()`로 **현재 UI**를 검수합니다.

- React / Vue / 순수 HTML renderer 모두 가능
- Whisper Net처럼 **테스트 전용 IPC 채널을 새로 만들 필요는 없음**
- 기존 사용자 흐름(클릭 → 화면 변화) 위에서 assertion

---

## 3. 앱 쪽 작업이 “거의 필수”인 이유

테스트 코드만 추가해도 **스모크(앱 실행)** 수준은 가능하지만, 실무에서 아래 이슈로 막히는 경우가 많습니다. Whisper Net Phase 6에서도 동일한 문제를 겪었습니다.

### 3.1 Dev 모드 vs 빌드 산출물

| 문제 | 원인 |
|------|------|
| 화면이 비어 있음 | `!app.isPackaged`일 때 `localhost:5173` 등 dev URL 로드 |
| DevTools 창만 잡힘 | dev 모드에서 DevTools가 먼저 열림 |

**대응:** E2E 모드에서는 dev URL/DevTools 대신 **빌드된 `index.html`** (`loadFile`) 사용.

```typescript
const isE2E = process.env.MYAPP_E2E === '1'
const isDev = !app.isPackaged && !isE2E

if (isDev) {
  win.loadURL('http://localhost:5173')
  win.webContents.openDevTools()
} else {
  win.loadFile(path.join(__dirname, '../renderer/index.html'))
}
```

### 3.2 트레이 / 창 닫기 = hide

| 문제 | 원인 |
|------|------|
| 테스트 후 프로세스가 안 죽음 | `close` 시 `preventDefault()` + `win.hide()` (트레이 앱) |
| CI worker teardown 120초 타임아웃 | 좀비 Electron 프로세스 잔류 |

**대응:**

- E2E 모드: `close` 시 정상 `quit` 허용, 트레이 생성 생략
- 테스트 종료 시 `app.evaluate(({ app }) => app.exit(0))` 후 `app.close()`

### 3.3 단일 인스턴스 잠금

| 문제 | 원인 |
|------|------|
| 두 번째 앱 인스턴스가 안 뜸 | `requestSingleInstanceLock()` |

**대응:** E2E 모드에서만 single-instance lock 비활성화.

### 3.4 설정·상태 충돌

| 문제 | 원인 |
|------|------|
| 닉네임·로그인 상태가 테스트 간 섞임 | 같은 `userData` 경로 공유 |

**대응:** launch마다 **`--user-data-dir` 분리** (앱 코드 수정 없이도 가능).

```typescript
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myapp-e2e-'))
await electron.launch({
  args: [mainPath, `--user-data-dir=${userDataDir}`],
})
```

---

## 4. 개발 시 미리 해두면 좋은 작업 (선택)

필수는 아니지만, E2E 도입·유지 비용을 줄입니다.

| 작업 | 효과 |
|------|------|
| Main에 E2E env 분기 (`MYAPP_E2E=1`) | dev URL, DevTools, tray, single-instance 일괄 제어 |
| 버튼·입력에 `aria-label` 또는 `data-testid` | CSS/문구 변경 시 테스트 깨짐 감소 |
| UI에 연결 정보 표시 (IP:port 등) | P2P·멀티 클라이언트 테스트 fallback |
| `tests/scenarios/*.md` + `*.spec.ts` 쌍 | 수동 QA와 자동 검수 동기화 |

**테스트 전용 비즈니스 API는 만들지 않아도 됩니다.**  
기존 IPC·이벤트·UI 흐름 위에서 화면만 검증하는 방식이면 충분합니다.

---

## 5. 프로젝트 유형별 난이도

| 유형 | 난이도 | 주로 필요한 추가 작업 |
|------|--------|----------------------|
| 단일 창, 빌드 후 `loadFile` | ⭐ 쉬움 | Playwright + 스모크 1개 |
| dev URL + DevTools 사용 | ⭐⭐ | E2E 모드에서 `loadFile` |
| 트레이 앱 (닫기 = hide) | ⭐⭐ | E2E에서 quit on close, `app.exit(0)` |
| 2클라이언트 (P2P, 채팅, 협업) | ⭐⭐⭐ | user-data-dir 2개, serial 테스트, 네트워크 fallback |
| `requestSingleInstanceLock` | ⭐⭐ | E2E에서 lock 해제 |

---

## 6. Whisper Net에서 실제로 넣은 최소 앱 변경

`src/main/index.ts`에 추가한 분기 요약:

```typescript
const isE2E = process.env.WHISPER_E2E === '1'
const isDev = !app.isPackaged && !isE2E

// 1) E2E → 빌드된 renderer (dev URL/DevTools 안 씀)
// 2) E2E → close 시 hide 대신 quit
// 3) E2E → 트레이 미생성
// 4) E2E → window-all-closed 시 app.quit()
```

테스트 launch:

```typescript
env: { ...process.env, WHISPER_E2E: '1' }
```

**약 10~20줄 수준의 Main 분기**로 E2E 안정성이 크게 달라집니다.

---

## 7. 필수 vs 선택 체크리스트

### 7.1 필수 (E2E 도입 최소 세트)

- [ ] `@playwright/test` 설치
- [ ] `playwright.config.ts` — `workers: 1`, 충분한 `timeout` (Electron·2인스턴스는 60~120s)
- [ ] `npm run build` 후 main 진입점 경로 확인
- [ ] launch 헬퍼 — `--user-data-dir`, `try/finally`로 종료 보장
- [ ] 스모크 1개 — 앱 실행 + 핵심 UI visible

### 7.2 강력 권장 (막히면 거의 여기서 해결)

- [ ] Main에 `MYAPP_E2E=1` 분기
- [ ] E2E: `loadFile`, DevTools off, tray off
- [ ] 종료: `app.exit(0)` + `app.close()`
- [ ] DevTools 창 제외 — `waitForEvent('window', { predicate })`

### 7.3 선택 (점진적 개선)

- [ ] `data-testid` / `aria-label`
- [ ] 핵심 user journey spec
- [ ] 멀티 인스턴스 + fallback (수동 연결, refresh)
- [ ] `--headed` 로컬 디버깅, `trace: 'on-first-retry'`

---

## 8. 권장 도입 순서 (기존 프로젝트)

1. **Playwright 설치** — `npm i -D @playwright/test`
2. **스모크 1개** — 앱 뜨고 타이틀/메인 화면 확인
3. **막히는 지점 정리** — dev URL? tray? single instance?
4. **E2E 모드 10~20줄** — Main `index.ts`에 env 분기
5. **핵심 시나리오 1개** — “A에서 행동 → B(또는 같은 앱) 화면에 반영”
6. **선택 개선** — `data-testid`, 시나리오 md, CI `npm run test:e2e`

---

## 9. 다른 스택과의 관계

| 대상 | Playwright E2E |
|------|----------------|
| **기존 Electron 앱** | ✅ 본 문서 + [E2E_VISUAL_REVIEW_AUTOMATION.md](./E2E_VISUAL_REVIEW_AUTOMATION.md) |
| **일반 웹 (Next/Vite SPA)** | ✅ `page.goto` + `webServer` (Electron launch 불필요) |
| **React Native / Flutter** | ❌ Detox, Maestro, Appium 등 별도 검토 |

---

## 10. FAQ

### Q. 코드를 많이 고쳐야 하나?

**아니요.** 테스트 파일 추가는 필수이고, 앱 쪽은 **Main 진입점에 E2E 분기**가 대부분입니다. Renderer 대규모 수정은 보통 필요 없습니다.

### Q. 아직 출시 전 dev-only 앱도 되나?

가능합니다. 다만 E2E는 **`npm run build` 산출물** 기준으로 돌리는 것이 안정적입니다. dev HMR과 E2E를 섞지 않는 편이 좋습니다.

### Q. CI에서도 되나?

됩니다. `npm run build && npm run test:e2e`, `workers: 1`, headless Electron. mDNS 등 환경 의존 시나리오는 **fallback(수동 연결)** 을 spec에 포함하세요.

### Q. 처음부터 E2E를 염두에 두고 개발해야 하나?

**아니요.** 다만 Main에 `process.env.MYAPP_E2E` 한 줄만 미리 받아두면, 나중에 tray/dev/single-instance 이슈를 한곳에서 제어할 수 있습니다.

---

## 11. 관련 문서

| 문서 | 내용 |
|------|------|
| [E2E_VISUAL_REVIEW_AUTOMATION.md](./E2E_VISUAL_REVIEW_AUTOMATION.md) | Playwright 구조, 헬퍼, 2인스턴스, 코드 예시 |
| [tests/scenarios/room-discovery.md](../tests/scenarios/room-discovery.md) | 수동 QA 시나리오 |
| [AGENTS.md](../AGENTS.md) §7 | Whisper Net 테스트 실행 방법 |

---

*Whisper Net 기준 env 이름은 `WHISPER_E2E`. 다른 프로젝트는 `MYAPP_E2E`, `E2E=1` 등 팀 convention에 맞게 바꾸면 됩니다.*
