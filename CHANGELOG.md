# Changelog

All notable changes to Whisper Net are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

---

## [1.9.0] — 2026-05-22

### Added

- **LAN 업데이트 (Phase 1)**: Ed25519 서명 manifest, SHA-256 검증, Origin HTTP 다운로드
- **`scripts/sign-release.mjs`**: 릴리스 팩 서명·`release-pack/_whisper-updates/verified/` 생성
- **UpdateModal**: Sidebar 버전 클릭 → 확인·다운로드·설치 파일 열기
- **공유폴더 보안**: `_whisper-updates/verified/` 외 HTTP serve 403

---

## [1.8.6] — 2026-05-22

### Fixed

- **나가기 후 재참여 실패**: 방을 광고하는 모든 피어에 `join_room` 전송, 호스트가 joiner에게 `room_members` 직접 전달
- **조인 신뢰성**: TCP 연결 확립 후 전송(`sendReliable`), 참여 전 피어 목록 refresh, 15초 타임아웃·오류 메시지
- **React duplicate key 경고**: 방 생성 시 `rooms` 배열 중복 제거, Discovered Rooms dedupe 강화
- **cmd+q 종료 크래시**: 소켓 종료 후 `data` 이벤트 race condition 방어, TCP 정리 로직 개선

---

## [1.8.5] — 2026-05-22

### Fixed

- **첨부 이미지 다운로드 404**: `messageId` 기준 `/whisper/room-attachment` 엔드포인트 추가, 파일명 불일치 시 폴더 내 단일 파일 fallback
- **다운로드 URL**: 경로 세그먼트별 인코딩, 다운로드 전 발신자 peer 정보 refresh

---

## [1.8.4] — 2026-05-22

### Fixed

- **클립보드 이미지 파일명**: `image.png` 등 기본 이름 대신 `clipboard-{timestamp}-{id}.png` 형식으로 고유 저장
- **첨부 파일 messageId**: 저장 경로와 네트워크 payload의 messageId 불일치 수정

---

## [1.8.3] — 2026-05-22

### Added

- **클립보드 이미지 붙여넣기**: 대화 입력창에 이미지 붙여넣기 시 파일 첨부와 동일하게 전송

---

## [1.8.2] — 2026-05-22

### Added

- **참여자 목록**: ChatView 헤더의 `N명 참여중` 클릭 시 닉네임·온라인 상태 표시

---

## [1.8.1] — 2026-05-22

### Added

- **참여/나가기 시스템 메시지**: 대화 타임라인 중앙에 `~님이 참여하였습니다.` / `~님이 나가셨습니다.` 표시

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
