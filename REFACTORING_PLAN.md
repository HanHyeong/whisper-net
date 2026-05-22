# Whisper Net 리팩토링 계획서

> **버전**: 1.7.0에 반영 완료  
> **목적**: P2P LAN 메신저 취지를 유지하면서, 발견·동기화·코드 구조의 근본 문제를 단계적으로 해소  
> **상태**: Phase 0~6 완료 (2026-05-22)

---

## 1. 프로젝트 취지 (리팩토링이 지켜야 할 것)

Whisper Net은 **중앙 서버 없이** 같은 LAN 안에서만 동작하는 데스크톱 메신저입니다.

| 원칙 | 의미 | 리팩토링 시 금지 |
|------|------|------------------|
| **완전 P2P** | 메시지·메타데이터가 외부 서버를 거치지 않음 | Redis/중앙 DB/클라우드 시그널링 |
| **오프라인 LAN** | 인터넷 없이 mDNS + 직접 TCP/HTTP | 클라우드 relay |
| **휘발성** | 메시지는 메모리 only | 로컬 DB 영구 저장 (명시 요구 없는 한) |
| **네트워크 레벨 보안** | AES-256-GCM, PBKDF2 | 암호화 약화 |
| **가벼운 확장** | Gossip fanout=3 | 전체 mesh 브로드캐스트 |

---

## 2. 당시 문제 요약 (1.7.0에서 해결)

- ~~**메타데이터 3갈래**~~ → `PeerSyncService` 단일 정책 (mDNS=발견, HTTP=스냅샷, TCP=push)
- ~~**피어 Map 이중 관리**~~ → `PeerRegistry` SSOT
- ~~**방 감지 실패**~~ → `peer:joined` HTTP pull, connect/discover_ack push, startup debounce
- ~~**God Object**~~ → NetworkManager facade + ipc/* 분리

---

## 3. 목표 메타데이터 동기화 모델

| 레이어 | 역할 | 갱신 시점 |
|--------|------|-----------|
| mDNS | peerId, ip, ports, nickname (발견) | 앱 시작 |
| HTTP GET `/whisper/peers` | rooms[] 스냅샷 (authoritative) | peer:joined, refresh |
| TCP `room_advertised` | rooms 변경 push | createRoom, connect, discover_ack |

### 동기화 트리거 (목표)

| 이벤트 | 동작 |
|--------|------|
| `peer:joined` | `refreshPeer(peerId)` HTTP pull |
| TCP `connected` / `discover_ack` | `advertiseRoomsToPeer()` push |
| `createRoom` / leave | HTTP snapshot + `room_advertised` push |
| Sidebar 🔄 | `refreshPeers()` (fallback) |

---

## 4. 단계별 실행 계획

### Phase 0 — 준비 ✅

- [x] `REFACTORING_PLAN.md` 작성
- [x] `tests/scenarios/room-discovery.md` 회귀 시나리오

### Phase 1 — 버그 수정 (Hotfix) ✅

| # | 작업 | 파일 |
|---|------|------|
| 1.1 | `peer:joined` → `refreshPeer(peerId)` | `DiscoveryManager`, `NetworkManager` |
| 1.2 | TCP `connected` + `discover_ack` → `advertiseRoomsToPeer()` | `NetworkManager` |
| 1.3 | `discover_ack.payload`에 rooms, discoveryPort 포함 | `NetworkManager` |
| 1.4 | `room_advertised` peer 미등록 시 pending queue | `NetworkManager` |
| 1.5 | `sendDirect` 실패 warn 로그 | `NetworkManager` |

### Phase 2 — 동기화 정책 통합 ✅

- [x] `PeerRegistry` — 피어 Map 단일 SSOT (`PeerRegistry.ts`)
- [x] `PeerSyncService` — HTTP pull, debounce, `updateLocalRooms()`, TCP push (`PeerSyncService.ts`)
- [x] `DiscoveryManager` — 내부 peers Map 제거, registry 위임
- [x] mDNS TXT에서 `rooms` 제거, `txt-update` 핸들러 추가
- [x] startup `schedulePeerRefresh(500)` debounced bulk refresh

### Phase 3 — NetworkManager 분해 ✅

- [x] `types.ts` — LocalPeer, Room, ChatMessage 공유 타입
- [x] `ConnectionPool.ts` — TcpServer + TcpClient, send/connect
- [x] `RoomService.ts` — create/join/leave, members, room protocol handlers
- [x] `MessageService.ts` — gossip, dedup, text/file relay, discover_ack
- [x] `NetworkManager.ts` — wiring facade (~220줄)

### Phase 4 — Main/IPC 정리 ✅

- [x] `ipc/context.ts` — 공유 상태·sendToRenderer
- [x] `ipc/appHandlers.ts` — app:* IPC
- [x] `ipc/networkHandlers.ts` — net:* IPC + network 이벤트 wiring
- [x] `ipc/fileTransferHandlers.ts` — 파일 첨부·1:1 전송·HTTP 다운로드
- [x] `utils/http.ts` — httpGet, downloadFile
- [x] `tray.ts` — 트레이·알림
- [x] `index.ts` — bootstrap (~130줄)

### Phase 5 — 알려진 버그 ✅

- [x] join stub 제거 — `room_members` 확인 후 로컬 방 생성 (`RoomService.pendingJoins`)
- [x] `members` 직렬화 — `serializeRoom()` + renderer `normalizeRoom()`
- [x] 비밀방 빈 비밀번호 — `createRoom` 서버 검증 + IPC `{ error }`
- [x] join UX — `network:room-joined` / `onJoinRejected` 모달 정리·자동 선택

### Phase 6 — 테스트 ✅

- [x] `tests/e2e/helpers/electron-app.ts` — 2인스턴스 launch·피어 연결 헬퍼
- [x] `tests/e2e/room-discovery.spec.ts` — 방 발견·join·비밀방·수동연결·refresh E2E
- [x] `npm run test:e2e` 스크립트 추가

---

## 5. 성공 지표

- [x] A가 방 생성 → B 접속 시 Discovered Rooms 표시 (Phase 1 + E2E)
- [x] B 선행 → A 후행 동일 (E2E)
- [x] 수동 IP 연결 후 방 목록 동기화 (E2E)
- [x] 비밀방 join / 거부 (E2E)
- [ ] 텍스트/파일 Gossip relay 회귀 (수동 시나리오)

---

## 6. 작업 순서

```
Phase 0 ✅ → Phase 1 ✅ → Phase 2 ✅ → Phase 3 ✅ → Phase 4 ✅ → Phase 5 ✅ → Phase 6 ✅
```

*코드/구조 변경 시 `PROJECT_MAPPING.md`, `AGENTS.md`, `CHANGELOG.md`와 함께 이 문서를 업데이트하세요.*
