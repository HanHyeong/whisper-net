# Changelog

All notable changes to Whisper Net are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

---

## [1.8.0] — 2026-05-22

### Added

- **대화방 나가기**: ChatView 헤더 「나가기」 버튼 + 확인 모달
- **상황별 동작**: 혼자 남으면 방 종료(`room_closed`), 다른 참여자 있으면 unjoin → Discovered Rooms 재표시
- **프로토콜**: `leave_room`(voluntary) 확장, `room_closed` 신규
- **E2E**: `tests/e2e/room-leave.spec.ts` (unjoin / close / private rejoin)

### Fixed

- **비밀방 재참여**: 참여자 로컬 방에 `passwordHash` 저장 — 생성자 나간 뒤에도 join 검증 가능

---

## [1.7.1] — 2026-05-22

### Added

- **단일 인스턴스 잠금**: 앱 중복 실행 시 기존 창 포커스 (`requestSingleInstanceLock`, E2E 모드 제외)

### Changed

- **비밀형 대화방 알림**: 메시지 내용 대신 `비밀메시지 (전송자이름)`만 표시 (미리보기 설정과 무관)

---

## [1.7.0] — 2026-05-22

### Added

- **방 발견·동기화 리팩토링** (Phase 0~5): `PeerRegistry`, `PeerSyncService`, mDNS/HTTP/TCP 단일 정책
- **Main/IPC 분리**: `ipc/*`, `tray.ts`, `utils/http.ts` — `index.ts` bootstrap (~130줄)
- **NetworkManager 분해**: `ConnectionPool`, `RoomService`, `MessageService`, `types.ts`
- **Join UX**: `room_members` 확인 후 로컬 방 생성, `network:room-joined` / join 거부 알림
- **E2E 검수 자동화** (Phase 6): Playwright 7 tests — 방 발견·join·비밀방·수동 연결·refresh
- **`WHISPER_E2E=1`**: E2E 전용 모드 (빌드 renderer, DevTools/트레이 비활성)
- **`npm run test:e2e`** 스크립트
- **문서**: `REFACTORING_PLAN.md`, `docs/E2E_*.md`, `tests/scenarios/room-discovery.md`

### Fixed

- A 선행 방 생성 시 B의 **Discovered Rooms** 비어 있던 문제 (`peer:joined` HTTP pull, TCP push)
- 비밀방 **비밀번호 틀려도 참여된 것처럼 보이던** stub join 문제
- **`members` 직렬화** — 참여자 수 UI (`명 참여중`) 표시
- 비밀방 **빈 비밀번호** 서버 측 검증
- 앱 시작 시 **너무 이른** `refreshPeers()` — `schedulePeerRefresh(500)` debounce

### Changed

- mDNS TXT에서 `rooms` 제거 (HTTP `/whisper/peers` + TCP `room_advertised`가 authoritative)
- Sidebar 빈 상태 문구: "피어 탐색 중…"

---

## [1.6.0]

- Electron 30 + React 18 P2P LAN 메신저 기준 릴리스
- mDNS 발견, Gossip relay, 비밀방, 파일 공유, 트레이·알림 등 핵심 기능

[1.7.0]: https://github.com/HanHyeong/whisper-net/compare/v1.6.0...v1.7.0
