# 대화방 나가기 기능 개발 계획서

> **대상 버전**: 1.8.0 (예정)  
> **목적**: 방장 개념 없이, **「나가기」 단일 액션**으로 대화방 참여 해제·종료 UX 제공  
> **상태**: Phase 1 MVP 구현 완료 (2026-05-22)  
> **관련 문서**: [REFACTORING_PLAN.md](../REFACTORING_PLAN.md), [PROJECT_MAPPING.md](../PROJECT_MAPPING.md), [tests/scenarios/room-discovery.md](../tests/scenarios/room-discovery.md)

---

## 1. 배경 및 목표

### 1.1 문제

현재 Whisper Net에는 대화방을 **나가거나 삭제하는 UI·프로토콜이 없다**.

- My Rooms에 추가된 방은 앱을 재시작하기 전까지 사이드바에 남음
- `leave_room` 메시지 타입은 **비밀번호 거부**(`wrong_password`) 용도로만 사용 중
- 사용자는 “더 이상 쓰지 않는 방”을 정리할 방법이 없음

### 1.2 설계 원칙 (확정)

| 원칙 | 내용 |
|------|------|
| **단일 액션** | UI에는 **「나가기」** 만 제공. 별도 「삭제」 버튼 없음 |
| **방장 없음** | `createdBy` / host 개념 도입하지 않음 |
| **상황별 분기** | 혼자 남았을 때 vs 다른 참여자가 있을 때 동작만 다름 |
| **P2P 일관성** | 로컬 상태 + `room_advertised` / HTTP discovery 정책 유지 |
| **휘발성 유지** | 나가기 시 **이 기기의** 메시지·방 상태 삭제 (서버 없음) |

### 1.3 목표 UX (한 줄 요약)

> **나가기** = My Rooms에서 제거.  
> 다른 사람이 남아 있으면 → **Discovered Rooms**에서 다시 Join 가능.  
> 나만 남았으면 → **방 종료** (광고 중단, 네트워크 정리).

---

## 2. 동작 명세

### 2.1 사용자 시나리오

#### A. 다른 참여자가 있을 때 나가기 (Unjoin)

```
[전]  A, B 모두 My Rooms에 "회의실" 표시
[A가 나가기]
[후]  A: My Rooms에서 제거 → Discovered Rooms에 "회의실" 표시
      B: My Rooms 유지, members에서 A 제거
```

- A는 **재참여** 시 Discovered Rooms → Join (비밀방이면 비밀번호 재입력)
- A 로컬 **대화 기록 소멸** (재입장 시 빈 방 — 히스토리 동기화 없음)

#### B. 혼자 남았을 때 나가기 (방 종료)

```
[전]  A만 My Rooms에 "회의실" (members = [A])
[A가 나가기]
[후]  A: 방·메시지 완전 삭제, room_advertised 목록에서 제거
      B(연결 중): room_closed 수신 → My/Discovered 목록에서 제거
```

#### C. Pending Join 취소

```
[전]  B가 Discovered Room Join 클릭 → room_members 대기 (pendingJoins)
[B가 나가기/취소]
[후]  pendingJoins 삭제, Join UI 닫힘
```

### 2.2 「혼자」 판정 기준

**Phase 1 (MVP)**

```typescript
const isLastMember =
  room.members.size === 1 && room.members.has(localPeerId)
```

**Phase 2 (선택 개선)**

- `PeerRegistry` 기준 **온라인 멤버**만 카운트
- 오프라인 peerId가 `members`에 남아 있어도 실질 혼자면 방 종료 허용

> MVP는 `members.size === 1`로 시작. LAN 소규모 사용에 충분하며 구현이 단순함.

### 2.3 확인 모달 문구

| 상황 | 제목 | 본문 |
|------|------|------|
| 다른 사람 있음 | 대화방 나가기 | 이 대화방을 나갑니다. 이 기기의 대화 내용은 삭제됩니다. 다시 참여하려면 Discovered Rooms에서 Join할 수 있습니다. |
| 혼자 | 대화방 나가기 | 이 대화방을 나가면 **방이 삭제**되고, 이 기기의 대화 내용이 사라집니다. |
| Pending Join | 참여 취소 | 방 참여를 취소합니다. |

---

## 3. 현재 코드베이스 분석

### 3.1 관련 파일

| 레이어 | 파일 | 현재 역할 | 변경 필요 |
|--------|------|-----------|-----------|
| Main | `RoomService.ts` | create/join, `handleLeaveRoom`(wrong_password만) | **`leaveRoom()` 추가**, leave/closed 핸들러 확장 |
| Main | `MessageService.ts` | `leave_room` → RoomService 위임 | **`room_closed` case 추가** |
| Main | `NetworkManager.ts` | facade | **`leaveRoom()` 노출** |
| Main | `PeerSyncService.ts` | `updateLocalRooms()` | leave 후 **광고 갱신** 호출 |
| Main | `protocol.ts` | `leave_room` 타입 존재 | **`LeaveRoomPayload`, `RoomClosedPayload`**, `room_closed` 타입 |
| IPC | `networkHandlers.ts` | net:* 핸들러 | **`net:leave-room` handle** |
| IPC | `context.ts` | mutedRoomIds 등 | leave 시 **mutedRoomIds 정리** (선택) |
| Preload | `preload/index.ts` | whisperAPI | **`leaveRoom(roomId)`** |
| Renderer | `ChatView.tsx` | 채팅 헤더 | **나가기 버튼 + 모달** |
| Renderer | `App.tsx` | 레이아웃·모달 | leave 핸들러, activeRoom 전환 |
| Renderer | `appStore.ts` | rooms 상태 | leave 후 rooms IPC push로 갱신 (로컬 patch 선택) |
| Renderer | `Sidebar.tsx` | My/Discovered Rooms | 변경 최소 (rooms 목록은 store 반영) |

### 3.2 기존 `leave_room` 사용처

```typescript
// RoomService.handleJoinRoom — 비밀번호 불일치 시만
{ type: 'leave_room', payload: { roomId, reason: 'wrong_password' } }
```

- `handleLeaveRoom`은 `reason === 'wrong_password'`일 때만 처리
- **일반 leave / room_closed와 충돌하지 않도록** payload 스키마 분리 필요

### 3.3 Discovery 연동

Discovered Rooms는 Renderer에서 계산:

```typescript
// Sidebar.tsx
const discoveredRooms = peers.flatMap(p => p.rooms || [])
const newDiscovered = discoveredRooms.filter(r => !myRoomIds.has(r.roomId))
```

→ A가 unjoin하면 `myRoomIds`에서 빠지므로, B가 여전히 광고하는 한 **자동으로 Discovered에 재표시**됨.  
→ A가 last-member leave하면 A의 `getLocalRoomList()`에서 제거 → A는 광고 안 함.

---

## 4. 프로토콜 설계

### 4.1 메시지 타입 추가·확장

```typescript
// protocol.ts

export type MessageType =
  | ...
  | 'leave_room'    // 기존 — 스키마 확장
  | 'room_closed'   // 신규
  | ...

export interface LeaveRoomPayload {
  roomId: string
  /** wrong_password | voluntary (기본) */
  reason?: 'wrong_password' | 'voluntary'
  /** leave하는 peerId (voluntary일 때) */
  leaverPeerId?: string
  /** leave 후 남은 members (voluntary일 때, gossip용) */
  members?: string[]
}

export interface RoomClosedPayload {
  roomId: string
  closedBy: string
}
```

### 4.2 메시지 흐름

#### voluntary leave (다른 사람 있음)

```
Leaver                    Room members (gossip fanout)
  │                              │
  ├── leave_room ───────────────►│ handleLeaveRoomVoluntary
  │   { roomId, leaverPeerId,    │  - members에서 leaver 제거
  │     members: [...] }          │  - room_members rebroadcast (선택)
  │                              │
  ├── [로컬 room 삭제]            │
  └── updateLocalRooms()         │
```

#### last-member leave (방 종료)

```
Last member                 Connected peers
  │                              │
  ├── room_closed ──────────────►│ handleRoomClosed
  │   { roomId, closedBy }       │  - 로컬 room 삭제 (있으면)
  │                              │  - closedRoomIds tombstone (선택)
  ├── [로컬 room 삭제]            │
  └── updateLocalRooms()         │
```

#### wrong_password (기존 — 변경 없음)

```
  leave_room { roomId, reason: 'wrong_password' }
  → pendingJoins 삭제, join:rejected
```

### 4.3 Gossip 정책

- `leave_room` (voluntary): `broadcastToRoom(roomId, msg, localPeerId)` — 기존 fanout=3 활용
- `room_closed`: **현재 방 members + 연결된 전체 peer**에게 전송 (방 목록 정리 목적)
  - MVP: `broadcastToRoom` + `advertiseRooms()` 로 충분
  - Phase 2: tombstone을 모든 peer에게 push

### 4.4 Tombstone (Phase 2, 선택)

```typescript
// ipcState 또는 RoomService
closedRoomIds: Set<string>  // room_closed 수신 roomId
```

- Discovered Rooms 필터: `closedRoomIds.has(roomId)` 제외
- 재생성 방지: 오프라인 peer가 stale room 재광고 시 UX 개선
- TTL 24h 또는 앱 세션 유지 — **Phase 2**

---

## 5. Backend 구현 상세

### 5.1 `RoomService.leaveRoom(roomId: string)`

```typescript
leaveRoom(roomId: string): { ok: boolean; error?: string } {
  // 1. pendingJoins에 있으면 → cancelPendingJoin(roomId)
  // 2. room 없으면 → { ok: false, error: 'not_found' }
  // 3. isLastMember 판정
  // 4a. last member:
  //     - broadcast room_closed
  //     - rooms.delete(roomId)
  // 4b. others remain:
  //     - room.members.delete(localPeerId)
  //     - broadcast leave_room { voluntary, leaverPeerId, members }
  //     - rooms.delete(roomId)  // 로컬 참여 해제
  // 5. onLocalRoomsChanged() → PeerSyncService.updateLocalRooms()
  // 6. return { ok: true }
}
```

### 5.2 `RoomService.handleLeaveRoom` 확장

```typescript
handleLeaveRoom(payload: LeaveRoomPayload, fromPeerId: string) {
  if (payload.reason === 'wrong_password') {
    // 기존 로직 유지
    return
  }
  // voluntary
  const room = this.rooms.get(payload.roomId)
  if (!room) return
  room.members.delete(fromPeerId)
  // payload.members가 있으면 merge/대체 (gossip 순서 이슈 방지)
  this.deps.onLocalRoomsChanged()
}
```

### 5.3 `RoomService.handleRoomClosed`

```typescript
handleRoomClosed(payload: RoomClosedPayload) {
  this.pendingJoins.delete(payload.roomId)
  if (this.rooms.has(payload.roomId)) {
    this.rooms.delete(payload.roomId)
    this.deps.onLocalRoomsChanged()
  }
  // Phase 2: closedRoomIds.add(payload.roomId)
}
```

### 5.4 `MessageService.handle`

```typescript
case 'leave_room':
  this.deps.roomService.handleLeaveRoom(msg.payload, msg.peerId)
  break
case 'room_closed':
  this.deps.roomService.handleRoomClosed(msg.payload)
  break
```

### 5.5 `NetworkManager`

```typescript
leaveRoom(roomId: string) {
  return this.roomService.leaveRoom(roomId)
}
```

### 5.6 부가 정리

| 항목 | leave 시 처리 |
|------|--------------|
| `ipcState.mutedRoomIds` | 해당 roomId delete |
| `activeRoomId` (Renderer) | 나간 방이면 null 또는 다른 방 |
| `unreadCounts` (appStore) | 해당 roomId delete |
| 파일 전송 중 | MVP: leave 허용 (전송 abort는 Phase 2) |

---

## 6. IPC / Preload

### 6.1 채널 추가

| 방향 | 채널 | payload | 응답 |
|------|------|---------|------|
| R→M | `net:leave-room` | `roomId: string` | `{ ok: boolean; error?: string }` |

### 6.2 Preload

```typescript
leaveRoom: (roomId: string) => ipcRenderer.invoke('net:leave-room', roomId),
```

### 6.3 Push 이벤트

- 기존 `network:rooms` push로 Sidebar 갱신 (별도 `room-left` 이벤트 불필요)
- activeRoom 나감 시 Renderer에서 `setActiveRoom(null)` 처리

---

## 7. Frontend 구현 상세

### 7.1 UI 배치

**ChatView 헤더** (1순위)

- 기존 알림 mute(🔔) 옆에 **「나가기」** 버튼
- `room.isPending`이면 **「참여 취소」** 로 라벨 변경

**Sidebar** (2순위, 선택)

- My Rooms 항목 hover 시 `×` 또는 컨텍스트 메뉴

### 7.2 App.tsx 흐름

```typescript
const handleLeaveRoom = async (roomId: string) => {
  const room = rooms.find(r => r.roomId === roomId)
  if (!room) return
  const isLast = room.members.length === 1 && room.members.includes(localPeerId)
  // 확인 모달 표시 (isLast에 따라 문구 분기)
  const result = await window.whisperAPI.leaveRoom(roomId)
  if (result.ok && activeRoomId === roomId) {
    setActiveRoom(null)
  }
}
```

### 7.3 `LeaveRoomModal` (신규 컴포넌트)

- Props: `room`, `isPending`, `isLastMember`, `onConfirm`, `onCancel`
- App.tsx 중앙 모달 패턴과 동일 (`NicknameModal`, `CreateRoomModal` 참고)

### 7.4 appStore

- IPC `network:rooms` 수신 시 기존 `setRooms`로 충분
- `clearUnread(roomId)`, `setMuted(roomId, false)` — leave 성공 후 호출

---

## 8. 단계별 실행 계획

### Phase 1 — Core (MVP) ☐

| # | 작업 | 파일 |
|---|------|------|
| 1.1 | `LeaveRoomPayload`, `RoomClosedPayload`, `room_closed` 타입 | `protocol.ts` |
| 1.2 | `leaveRoom()`, `handleLeaveRoom` voluntary, `handleRoomClosed` | `RoomService.ts` |
| 1.3 | `leave_room` / `room_closed` dispatch | `MessageService.ts` |
| 1.4 | `NetworkManager.leaveRoom()` | `NetworkManager.ts` |
| 1.5 | `net:leave-room` IPC | `networkHandlers.ts` |
| 1.6 | `leaveRoom` preload API | `preload/index.ts` |
| 1.7 | ChatView 나가기 버튼 + LeaveRoomModal | `ChatView.tsx`, `LeaveRoomModal.tsx`, `App.tsx` |
| 1.8 | leave 후 activeRoom / unread / mute 정리 | `App.tsx`, `appStore.ts` |
| 1.9 | `updateLocalRooms()` leave 후 호출 확인 | `RoomService` → `onLocalRoomsChanged` |

**완료 기준**

- [ ] 2인 Public 방: A unjoin → A Discovered 표시, B My Rooms 유지
- [ ] 1인 방: 나가기 → My/Discovered 모두 없음
- [ ] 비밀방 unjoin → 재join 시 비밀번호 요구
- [ ] wrong_password leave 기존 동작 회귀 없음

### Phase 2 — UX·안정화 ☐

| # | 작업 |
|---|------|
| 2.1 | `closedRoomIds` tombstone + Discovered 필터 |
| 2.2 | 온라인 멤버 기준 `isLastMember` 개선 |
| 2.3 | Sidebar 컨텍스트 메뉴 나가기 |
| 2.4 | 파일 전송 중 leave 시 transfer cleanup |

### Phase 3 — 테스트·문서 ☐

| # | 작업 | 파일 |
|---|------|------|
| 3.1 | E2E: unjoin → rediscover → rejoin | `tests/e2e/room-leave.spec.ts` |
| 3.2 | E2E: last-member leave | 동일 |
| 3.3 | 수동 시나리오 | `tests/scenarios/room-leave.md` |
| 3.4 | PROJECT_MAPPING §8 IPC, §9 프로토콜, §14.6 버그표 | `PROJECT_MAPPING.md` |
| 3.5 | AGENTS.md 디렉토리·기능 요약 | `AGENTS.md` |
| 3.6 | CHANGELOG [1.8.0] | `CHANGELOG.md` |

---

## 9. 테스트 계획

### 9.1 E2E 시나리오 (자동)

**`room-leave-unjoin`**

1. A, B 실행 → Public 방 생성 → B join
2. A ChatView **나가기** → 확인
3. **기대**: A My Rooms 비어 있음, Discovered에 방 표시
4. **기대**: B My Rooms에 방 유지
5. A Discovered에서 Join → 메시지 송수신

**`room-leave-close`**

1. A만 Public 방 생성 (혼자)
2. A 나가기
3. **기대**: A My/Discovered 모두 없음
4. B 실행 후 refresh → 해당 방 미표시

**`room-leave-private`**

1. A Private 방 → B join → A unjoin
2. A Discovered 🔒 Join → 비밀번호 입력 → 재참여

**`room-leave-regression`**

1. 비밀방 wrong_password → 거부 모달 (기존)
2. pending join 취소

### 9.2 수동 QA (`tests/scenarios/room-leave.md`)

- 3인 방에서 1명 unjoin → members 수 UI 갱신
- 나간 방 activeRoom 자동 해제
- mute 설정된 방 나가기 → mutedRoomIds 정리
- 앱 트레이 숨김 상태에서 leave (UI only)

### 9.3 회귀 체크

- [ ] 방 생성·join·메시지 Gossip
- [ ] Discovered Rooms refresh
- [ ] 비밀방 암호화·알림 `비밀메시지 (전송자)`
- [ ] E2E 2인스턴스 (`WHISPER_E2E=1` single-instance lock 미적용)

---

## 10. 엣지 케이스 및 정책

| # | 상황 | 정책 |
|---|------|------|
| E1 | offline member가 members에 남음 | MVP: size > 1이면 unjoin. Phase 2: online count |
| E2 | leave 직후 다른 peer가 room_advertised stale 전송 | HTTP refresh / tombstone으로 수렴 |
| E3 | 재join 후 메시지 history | 로컬 빈 방 (명시). 서버less 한계 |
| E4 | 생성 직후 혼자 → 나가기 | room_closed + 광고 중단 |
| E5 | 나가는 peer가 유일한 relay | Gossip fanout — 다른 member가 relay |
| E6 | leave_room과 wrong_password 구분 | `reason` 필드 필수 convention |
| E7 | E2E 다중 인스턴스 | single-instance lock은 E2E 제외 (기존) |

---

## 11. 데이터 흐름 다이어그램

### Unjoin (다른 참여자 있음)

```
[Renderer] 나가기 클릭
    → leaveRoom(roomId) IPC
        → RoomService.leaveRoom
            → leave_room broadcast (voluntary)
            → rooms.delete (local)
            → onLocalRoomsChanged → PeerSyncService.updateLocalRooms
    ← network:rooms push
[Renderer] setRooms → Sidebar My Rooms 제거, Discovered 추가
```

### Last-member leave

```
[Renderer] 나가기 클릭
    → leaveRoom(roomId) IPC
        → RoomService.leaveRoom
            → room_closed broadcast
            → rooms.delete (local)
            → updateLocalRooms (광고 제거)
[Other peers] handleRoomClosed → rooms.delete
[Renderer] activeRoom = null
```

---

## 12. 버전·문서 갱신 체크리스트

구현 완료 시:

- [ ] `package.json` → `1.8.0`
- [ ] `CHANGELOG.md` — Added: 대화방 나가기
- [ ] `PROJECT_MAPPING.md` — IPC `net:leave-room`, 프로토콜 `room_closed`, §15 흐름도
- [ ] `AGENTS.md` — 기능 요약 1줄
- [ ] `README.md` — 사용법 「대화방 나가기」 (선택)

---

## 13. 비목표 (Out of Scope)

- 방장 / 강제 해산 / 투표 삭제
- 나가기 후 **메시지 히스토리 동기화**
- 나간 방 **영구 ban** (재join 금지)
- 서버-side audit log

---

## 14. 일정 추정

| Phase | 예상 공수 | 산출물 |
|-------|-----------|--------|
| Phase 1 MVP | 1~2일 | leave core + UI |
| Phase 2 | 0.5~1일 | tombstone, polish |
| Phase 3 | 0.5~1일 | E2E + 문서 |
| **합계** | **2~4일** | v1.8.0 |

---

*이 문서는 구현 착수·완료 시 `PROJECT_MAPPING.md` 및 `CHANGELOG.md`와 동기화합니다.*
