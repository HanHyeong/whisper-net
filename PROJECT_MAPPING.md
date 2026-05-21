# Whisper Net — Project Mapping Document

> **목적**: 유지보수 및 신규 기능 개발 시 코드베이스 탐색 시간을 최소화하기 위한 전체 맵핑 문서  
> **버전**: 1.4.1 (package.json 기준)  
> **작성일**: 2026-05-20  
> **프로젝트 유형**: Electron 기반 P2P LAN 메신저 데스크톱 앱

---

## 1. 프로젝트 개요

**Whisper Net**은 중앙 서버 없이 동작하는 P2P LAN 메신저입니다. 같은 네트워크 내 기기들이 mDNS로 서로를 발견하고, TCP 소켓으로 직접 메시지를 주고받습니다. 메시지는 메모리에만 저장되며 앱 종료 시 삭제됩니다.

| 항목 | 내용 |
|------|------|
| **이름** | whisper-net |
| **버전** | 1.4.1 |
| **라이선스** | MIT |
| **메인 엔트리** | `./out/main/index.js` (빌드 후) |
| **앱 ID** | `com.whisper-net.app` |
| **제품명** | Whisper Net |

---

## 2. 기술 스택

| 분야 | 기술 | 버전 | 역할 |
|------|------|------|------|
| **런타임** | Electron | 30.0.8 | 데스크톱 앱 래퍼 (Main + Renderer 프로세스) |
| **UI 프레임워크** | React | 18.3.1 | 렌더러 프로세스 UI |
| **언어** | TypeScript | 5.4.5 | 전체 코드베이스 |
| **빌드 도구** | electron-vite | 2.2.0 | Main/Preload/Renderer 3중 빌드 |
| **번들러** | Vite | 5.2.11 | Renderer 번들링 |
| **스타일링** | Tailwind CSS | 3.4.3 | 유틸리티 CSS |
| **CSS 후처리** | PostCSS + Autoprefixer | 8.4.38 / 10.4.19 | CSS 처리 |
| **상태 관리** | Zustand | 4.5.2 | 글로벌 클라이언트 상태 |
| **P2P 발견** | bonjour-service | 1.3.0 | mDNS(Bonjour) 서비스 발견 |
| **TCP 통신** | Node.js `net` | 내장 | P2P 메시지 송수신 |
| **HTTP 서버** | Node.js `http` | 내장 | 메타데이터 제공 + 파일 서빙 |
| **암호화** | Node.js `crypto` | 내장 | PBKDF2 + AES-256-GCM |
| **테스트** | Playwright | 1.60.0 | E2E 테스트 |
| **패키징** | electron-builder | 24.13.3 | dmg/nsis/AppImage 생성 |

---

## 3. 아키텍처 개요 (3-Layer)

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: Renderer Process (Chromium)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  Sidebar    │  │  ChatView   │  │  SharedFileBrowser      │ │
│  │  (피어/방)   │  │  (대화화면)  │  │  (공유폴터 탐색)         │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  App.tsx  ──>  Zustand Store (appStore.ts)               │ │
│  │  React Hooks: useState, useEffect, useRef                │ │
│  └───────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  IPC Bridge (contextIsolation = true)                           │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  preload/index.ts  ──>  window.whisperAPI 노출           │ │
│  │  ipcRenderer.invoke / ipcRenderer.on                      │ │
│  └───────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 1: Main Process (Node.js)                                │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  index.ts  ──>  BrowserWindow, ipcMain 핸들러, 파일전송   │ │
│  │  NetworkManager.ts  ──>  EventEmitter 기반 네트워크 코어  │ │
│  │  ├─ DiscoveryManager.ts  ──>  발견 오케스트레이션         │ │
│  │  │   ├─ MdnsDiscovery.ts  ──>  mDNS 기반 피어 발견        │ │
│  │  │   └─ TcpDiscovery.ts   ──>  HTTP 서버 (8080~8083)     │ │
│  │  ├─ TcpServer.ts  ──>  TCP 수신 서버 (41235+)            │ │
│  │  ├─ TcpClient.ts  ──>  TCP 발신 클라이언트               │ │
│  │  ├─ protocol.ts   ──>  메시지 타입/인코딩/디코딩         │ │
│  │  └─ crypto.ts     ──>  암호화/복호화/키 파생             │ │
│  │  utils/config.ts  ──>  설정 파일 로드/저장               │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 디렉토리 및 파일 맵

```
whisper-net/
├── build/                          # 앱 아이콘 (icon.png)
├── dist/                           # electron-builder 배포 출력
├── out/                            # electron-vite 빌드 출력
│   ├── main/                       # main 프로세스 빌드 결과
│   ├── preload/                    # preload 스크립트 빌드 결과
│   └── renderer/                   # renderer 빌드 결과
├── src/
│   ├── main/
│   │   ├── index.ts                # ⭐ 앱 진입점, 윈도우 생성, IPC 핸들러
│   │   ├── network/
│   │   │   ├── NetworkManager.ts   # ⭐ 네트워크 코어 (방, 메시지, 피어 관리)
│   │   │   ├── DiscoveryManager.ts # ⭐ 발견 관리 (mDNS + HTTP 오케스트레이션)
│   │   │   ├── MdnsDiscovery.ts    # mDNS 서비스 발견/발행
│   │   │   ├── TcpDiscovery.ts     # HTTP 메타데이터 서버 + 파일 서빙
│   │   │   ├── TcpServer.ts        # TCP 수신 서버
│   │   │   ├── TcpClient.ts        # TCP 발신 클라이언트
│   │   │   ├── protocol.ts         # 메시지 프로토콜 정의
│   │   │   └── crypto.ts           # 암호화 유틸리티
│   │   └── utils/
│   │       └── config.ts           # 설정 파일 로드/저장
│   ├── preload/
│   │   └── index.ts                # IPC 브리지 (renderer <-> main)
│   └── renderer/
│       ├── App.tsx                 # ⭐ 메인 레이아웃, 이벤트 구독
│       ├── main.tsx                # React DOM 진입점
│       ├── index.css               # Tailwind 지시어 + 전역 스타일
│       ├── index.html              # HTML 템플릿
│       ├── stores/
│       │   └── appStore.ts         # ⭐ Zustand 글로벌 상태
│       └── components/
│           ├── Sidebar.tsx         # 사이드바 (피어/방 목록)
│           ├── ChatView.tsx        # 대화 화면
│           ├── CreateRoomModal.tsx # 방 생성 모달
│           ├── JoinRoomModal.tsx   # 방 참여 모달 (비밀방)
│           ├── NicknameModal.tsx   # 닉네임 설정 모달
│           ├── ManualConnectModal.tsx # 수동 IP 연결 모달
│           └── SharedFileBrowser.tsx # 공유 폴터 탐색기
├── tests/
│   └── e2e/
│       └── app.spec.ts             # Playwright E2E 테스트
├── package.json
├── tsconfig.json
├── electron.vite.config.ts         # Vite 빌드 설정
├── playwright.config.ts            # E2E 테스트 설정
├── postcss.config.js               # PostCSS 설정
├── tailwind.config.js              # Tailwind 설정
├── .env                            # 환경변수 (민감)
├── .gitignore
└── README.md
```

---

## 5. 메인 프로세스 코드 흐름 상세 분석

### 5.1 index.ts — 앱 생명주기 & IPC 중앙 허브

**위치**: `src/main/index.ts` (431줄)

**핵심 역할**:
1. `BrowserWindow` 생성 및 로드
2. `NetworkManager` 인스턴스화 및 시작
3. 모든 `ipcMain.handle` / `ipcMain.on` 등록
4. 파일 전송 상태 관리 (`activeTransfers` Map)
5. 트레이 아이콘 생성 (`createTray`) 및 윈도우 `close` 이벤트 가로채기 (숨김)
6. 앱 종료 시 정리 (`before-quit`: 파일 삭제, 소켓 종료)

**앱 실행 흐름**:
```
app.whenReady()
  └── Menu.setApplicationMenu(null)      # 기본 메뉴 제거
  └── loadConfig()                       # ~/whisper-config.json 로드
  └── createWindow(nickname, sharedPath) # 윈도우 생성
      ├── BrowserWindow 생성 (1100x720)
      ├── preload: ../preload/index.js 로드
      ├── 개발모드: localhost:5173 로드 / 배포: index.html 로드
      ├── NetworkManager 생성 (랜덤 UUID peerId, 랜덤 TCP 포트 41235+)
      ├── network.start()                # 서버/클라이언트/발견 시작
      ├── IPC 핸들러 등록 (아래 참조)
      ├── win.on('close') -> hide()      # 닫기 시 트레이로 숨김
      └── createTray()                   # 트레이 아이콘 + 더블클릭/메뉴
```

**IPC 핸들러 목록**:

| 채널 | 방향 | 설명 | 호출 파일 |
|------|------|------|----------|
| `app:get-config` | R→M | 설정 로드 | App.tsx |
| `app:get-version` | R→M | 버전 조회 | Sidebar.tsx |
| `app:get-local-info` | R→M | 로컬 IP/포트 조회 | Sidebar.tsx |
| `app:set-nickname` | R→M | 닉네임 변경 저장 | App.tsx |
| `net:create-room` | R→M | 방 생성 | CreateRoomModal.tsx |
| `net:join-room` | R→M | 방 참여 | App.tsx (JoinRoomModal) |
| `net:send-text` | R→M | 텍스트 메시지 전송 | ChatView.tsx |
| `net:send-file-attachment` | R→M | 대화방 파일 첨부 (10MB 제한) | App.tsx |
| `net:download-attachment` | R→M | 첨부 파일 다운로드 | App.tsx |
| `net:get-peers` | R→M | 피어 목록 조회 | - |
| `net:get-rooms` | R→M | 방 목록 조회 | App.tsx |
| `net:connect-peer` | R→M | 수동 IP 연결 | ManualConnectModal.tsx |
| `net:refresh-peers` | R→M | 피어 정보 새로고침 | Sidebar.tsx |
| `net:offer-file` | R→M | 1:1 파일 전송 요청 | App.tsx (Sidebar) |
| `net:accept-file` | R→M | 파일 수신 수락 | App.tsx |
| `net:cancel-transfer` | R→M | 전송 취소 | App.tsx |
| `app:set-shared-folder` | R→M | 공유 폴터 설정/해제 | App.tsx |
| `app:get-shared-folder` | R→M | 공유 폴터 경로 조회 | - |
| `app:select-download-folder` | R→M | 다운로드 폴터 선택 | SharedFileBrowser.tsx |
| `app:open-file` | R→M | 파일 기본 앱으로 열기 | ChatView.tsx |
| `app:show-in-folder` | R→M | 파일이 있는 폴터 열기 | ChatView.tsx |
| `net:list-peer-files` | R→M | 피어 공유 폴터 목록 조회 | SharedFileBrowser.tsx |
| `net:download-peer-files` | R→M | 피어 파일 다중 다운로드 | SharedFileBrowser.tsx |
| `app:renderer-ready` | R→M | 렌더러 준비 완료 신호 | App.tsx |

**Renderer → Main 이벤트 (push)**:

| 채널 | 방향 | 설명 | 수신 파일 |
|------|------|------|----------|
| `network:peers` | M→R | 피어 목록 업데이트 | App.tsx |
| `network:message` | M→R | 새 메시지 수신 | App.tsx |
| `network:file:offer` | M→R | 파일 전송 요청 수신 | App.tsx |
| `network:file:chunk` | M→R | 파일 청크 수신 | index.ts (writeStream) |
| `network:local` | M→R | 로컬 피어 정보 전달 | App.tsx |
| `file:progress` | M→R | 전송 진행률 | App.tsx |
| `file:complete` | M→R | 전송 완료 | App.tsx |

**파일 전송 상태 관리** (`activeTransfers: Map<string, {...}>`):
- **sender 측**: `offerFile` → `sendFileChunks` (64KB 청크, 5ms 딜레이) → `file:progress` / `file:complete` 이벤트
- **receiver 측**: `file:offer` 수신 → `acceptFile`로 저장 경로 선택 → `file:chunk` 수신 시 `WriteStream`에 기록 → 완료 시 `file:complete`

---

### 5.2 NetworkManager.ts — 네트워크 코어

**위치**: `src/main/network/NetworkManager.ts` (571줄)

**핵심 역할**: EventEmitter 기반. 방(Room), 피어(Peer), 메시지의 중앙 관리자.

**주요 상태**:
```typescript
rooms: Map<string, Room>           # roomId -> Room
peers: Map<string, PeerInfo>       # peerId -> PeerInfo
seenMessages: Set<string>          # 중복 메시지 방지 (UUID, 최대 10000개)
```

**생성 및 시작 흐름**:
```
new NetworkManager({peerId, nickname, tcpPort})
  ├── DiscoveryManager 생성
  ├── TcpServer 생성 (수신용, port = tcpPort)
  ├── TcpClient 생성 (발신용)
  └── start()
      ├── server.start()           # TCP 서버 리슨
      ├── server.on('message')     # 수신 메시지 -> handleMessage()
      ├── server.on('peer:disconnect') -> handlePeerDisconnect()
      ├── client.on('message')     # 발신 소켓으로부터의 응답 -> handleMessage()
      ├── client.on('connected')   # 연결 성공 -> registerSocket + discover_ack 전송
      ├── discovery.start()        # mDNS + HTTP 서버 시작
      └── discovery.on('peer:joined') -> client.connect(ip, port)
```

**메시지 처리 흐름** (`handleMessage`):

```
handleMessage(msg, socket?)
  ├── text_message
  │   ├── seenMessages dedup (gossip 방지)
  │   ├── 방 존재 확인
  │   ├── 암호화 방이면 decrypt()
  │   ├── ChatMessage 생성 → rooms[roomId].messages.push()
  │   ├── 'message' 이벤트 emit (Renderer로 전달)
  │   └── broadcastToRoom() (원발신자 제외, fanout=3)
  ├── join_room
  │   ├── 비밀방이면 passwordHash 검증
  │   ├── members.add(peerId)
  │   └── room_members 브로드캐스트
  ├── file_attachment
  │   ├── text_message와 동일한 dedup 로직
  │   ├── 📎 파일명 형태로 content 표시
  │   └── broadcastToRoom()
  ├── room_members
  │   └── members Set 동기화
  ├── file_offer
  │   └── 'file:offer' 이벤트 emit (Renderer로 전달)
  ├── file_chunk
  │   └── 'file:chunk' 이벤트 emit (index.ts에서 WriteStream 처리)
  ├── nickname_changed
  │   └── peers[peerId].nickname 업데이트
  └── discover_ack
      └── server.registerSocket() + peers 등록
```

**방 브로드캐스트** (`broadcastToRoom`):
- 방 멤버 중 자신과 `excludePeerId`를 제외
- 멤버 수가 FANOUT(3)을 초과하면 **랜덤 3명에게만 전송** (Gossip 프로토콜)
- 이를 통해 대규모 방에서도 네트워크 오버로드 방지

**메시지 전송 메서드**:

| 메서드 | 설명 |
|--------|------|
| `sendText(roomId, content)` | 텍스트 메시지 암호화 → broadcast |
| `sendFileAttachment(...)` | 파일 첨부 메시지 생성 → broadcast |
| `getLocalIp()` | 로컬 IP 주소 반환 (TcpDiscovery 위임) |
| `getTcpPort()` | TCP 수신 포트 반환 |
| `getDiscoveryPort()` | HTTP discovery 포트 반환 (TcpDiscovery 위임) |
| `offerFile(peerId, ...)` | 1:1 파일 전송 offer (TCP direct) |
| `sendFileChunk(peerId, ...)` | 1:1 파일 청크 전송 |
| `sendDirect(peerId, msg)` | server.send() || client.send() → 실패 시 재연결 시도 |

---

### 5.3 DiscoveryManager.ts — 발견 오케스트레이션

**위치**: `src/main/network/DiscoveryManager.ts` (141줄)

**핵심 역할**: TcpDiscovery와 MdnsDiscovery를 조합하여 피어 발견을 관리합니다.

**흐름**:
```
start()
  ├── tcp.start()          # HTTP 서버 시작 (8080~8083 중 사용 가능 포트)
  └── activateMdns()       # mDNS를 PRIMARY 발견 수단으로 사용
      ├── MdnsDiscovery 생성 (tcp.getPort(), tcp.getLocalIp() 전달)
      ├── mdns.on('peer:found') -> handlePeer() -> 'peer:joined' / 'peer:updated'
      └── mdns.on('peer:left') -> peers.delete() -> 'peer:left'
```

**refreshPeers()**: HTTP GET `/whisper/peers`로 모든 알려진 피어의 최신 정보(닉네임, 방 목록)를 동기화합니다. Sidebar의 🔄 버튼으로 호출됩니다.

**로컬 정보 조회 메서드**:
- `getLocalIp()`: TcpDiscovery.getLocalIp() 위임. 비공인 IPv4 우선, 없으면 첫 번째 IPv4
- `getDiscoveryPort()`: TcpDiscovery.getPort() 위임. HTTP 서버가 실제 바인딩한 포트 (8080~8083 중 하나)

---

### 5.4 MdnsDiscovery.ts — mDNS 서비스 발견

**위치**: `src/main/network/MdnsDiscovery.ts` (90줄)

**핵심 역할**: `bonjour-service` 라이브러리를 사용하여 자신을 mDNS에 발행하고 다른 피어를 탐색합니다.

**서비스 타입**: `_whisper._tcp`

**TXT 레코드** (자신을 발행할 때 포함):
```
peerId, nickname, rooms (JSON), discoveryPort, ip
```

**주의**: Windows에서 `.local` 도메인 이슈를 피하기 위해 TXT 레코드의 `ip` 필드를 우선 사용합니다.

---

### 5.5 TcpDiscovery.ts — HTTP 메타데이터 서버

**위치**: `src/main/network/TcpDiscovery.ts` (203줄)

**핵심 역할**: HTTP 서버로 동작하여 피어 정보 제공 및 공유 폴터 파일 서빙을 담당합니다.

**포트**: 8080, 8081, 8082, 8083 중 사용 가능한 첫 번째 포트

**엔드포인트**:

| 경로 | 메서드 | 설명 |
|------|--------|------|
| `/whisper/peers` | GET | 자신의 피어 정보 + 방 목록 반환 |
| `/whisper/heartbeat` | POST | heartbeat 수신 (현재는 no-op) |
| `/whisper/share` | GET | 공유 폴터 목록 조회 (JSON). `?path=relative` 지원 |
| `/whisper/share/{fileName}` | GET | 파일 다운로드 (application/octet-stream) |

**보안**: `path.resolve()` 기반 Path Traversal 방지. `resolvedTarget.startsWith(resolvedShared)` 검증.

---

### 5.6 TcpServer.ts / TcpClient.ts — TCP 통신

**TcpServer** (`src/main/network/TcpServer.ts`, 72줄):
- `net.createServer()`로 수신 대기
- **길이-프리픽스 프로토콜**: 4바이트 BE 길이 헤더 + JSON 페이로드
- `registerSocket(peerId, socket)`: discover_ack 수신 후 peerId와 소켓 매핑
- `send(peerId, msg)`: 매핑된 소켓으로 `encodeMessage()` 후 write

**TcpClient** (`src/main/network/TcpClient.ts`, 100줄):
- `connect(peerId, ip, port)`: 새 net.Socket 생성 및 연결
- **중복 연결 방지**: `connecting` Set으로 동일 peerId 동시 연결 시도 방지
- `send(peerId, msg)`: 연결된 소켓으로 메시지 전송
- `disconnect(peerId)`: 소켓 destroy 및 정리

**양방향 소켓 관리**:
- TcpServer: **수신** 소켓 (다른 피어가 나에게 연결)
- TcpClient: **발신** 소켓 (내가 다른 피어에게 연결)
- NetworkManager는 두 쪽 모두에서 메시지를 받을 수 있음

---

### 5.7 protocol.ts — 메시지 프로토콜

**위치**: `src/main/network/protocol.ts` (111줄)

**메시지 타입**:

```typescript
MessageType =
  | 'heartbeat'
  | 'discover'
  | 'discover_ack'
  | 'join_room'
  | 'leave_room'
  | 'room_members'
  | 'text_message'
  | 'file_attachment'
  | 'nickname_changed'
  | 'file_offer'
  | 'file_accept'
  | 'file_reject'
  | 'file_chunk'
  | 'file_complete'
  | 'typing'
```

**인코딩/디코딩**:
```typescript
encodeMessage(msg) -> Buffer    # 4바이트 BE 길이 + JSON UTF-8
decodeMessages(data) -> { messages, remainder }  # 스트리밍 파싱 지원
```

**핵심 인터페이스**:

| 인터페이스 | 필드 |
|-----------|------|
| `PeerInfo` | peerId, nickname, ip, tcpPort, discoveryPort, lastSeen, rooms |
| `RoomInfo` | roomId, name, type, memberCount |
| `ProtocolMessage` | type, peerId, nickname, timestamp, payload? |
| `TextMessagePayload` | roomId, content, messageId |
| `FileAttachmentPayload` | roomId, fileName, fileSize, checksum, messageId, content? |
| `FileOfferPayload` | transferId, fileName, fileSize, mimeType |
| `FileChunkPayload` | transferId, chunk(base64), index, total |

---

### 5.8 crypto.ts — 암호화

**위치**: `src/main/network/crypto.ts` (58줄)

| 함수 | 설명 |
|------|------|
| `deriveKey(password, roomId)` | PBKDF2(100,000회) → AES-256 키 생성. 비밀방용 |
| `deriveRoomKey(roomId)` | PBKDF2(1,000회) → AES-256 키 생성. 일반방용 |
| `hashPassword(password)` | SHA-256(비밀번호 + salt). 비밀번호 검증용 |
| `encrypt(plaintext, key)` | AES-256-GCM. 출력: `base64(iv):base64(authTag):base64(ciphertext)` |
| `decrypt(ciphertext, key)` | AES-256-GCM 복호화. 실패 시 예외 발생 |

---

### 5.9 config.ts — 설정 파일

**위치**: `src/main/utils/config.ts` (32줄)

- **저장 경로**: `app.getPath('userData')/whisper-config.json`
  - macOS: `~/Library/Application Support/whisper-net/whisper-config.json`
- **필드**: `nickname`, `sharedPath`
- **API**: `loadConfig()`, `saveConfig(partial)`

---

## 6. 프리로드 프로세스 코드 흐름

### 6.1 preload/index.ts — IPC 브리지

**위치**: `src/preload/index.ts` (78줄)

**설계 원칙**: `contextIsolation: true` 환경에서 Renderer가 Node.js API에 직접 접근하지 못하도록 `contextBridge.exposeInMainWorld('whisperAPI', api)`로 안전하게 노출합니다.

**API 구조**:
- **Invoke 메서드** (양방향 요청-응답): `ipcRenderer.invoke(channel, ...args)`
- **Event 구독 메서드** (Main → Renderer push): `ipcRenderer.on(channel, handler)`, 구독 해제 함수 반환

Renderer 코드에서는 전역 `window.whisperAPI` 객체를 통해 모든 Main 프로세스 기능에 접근합니다.

---

## 7. 렌더러 프로세스 코드 흐름

### 7.1 main.tsx — React 진입점

**위치**: `src/renderer/main.tsx` (10줄)

- `ReactDOM.createRoot()`로 StrictMode 하에 `<App />` 렌더링
- Tailwind CSS 지시어가 포함된 `index.css` 임포트

### 7.2 App.tsx — 메인 레이아웃 & 이벤트 허브

**위치**: `src/renderer/App.tsx` (298줄)

**상태 및 로직**:
- `useAppStore()`로 Zustand 상태 구독
- `useState`로 모달 표시 상태 관리 (Create, Nickname, Manual, Join, FileBrowser)
- `useEffect`에서 **6개의 IPC 이벤트 구독** 설정 및 해제

**마운트 시 초기화 흐름**:
```
useEffect (mount)
  ├── onPeers -> setPeers()           # 피어 목록 수신
  ├── onMessage -> addMessage()       # 메시지 수신 (안 읽은 카운트 증가)
  ├── onFileOffer -> confirm()        # 파일 수락/거절
  ├── onLocal -> setLocalPeerId/Nickname  # 로컬 정보 수신
  ├── onFileProgress -> updateTransfer()   # 진행률 업데이트
  ├── onFileComplete -> updateTransfer()   # 완료 처리 (4초 후 제거)
  ├── rendererReady()                  # Main에 준비 완료 알림
  ├── getConfig() -> 닉네임 없으면 NicknameModal 표시
  └── getRooms() -> rooms 상태 동기화
```

**파일 첨부 핸들러** (`handleSendFileAttachment`):
- `sharedFolder`가 설정되지 않은 경우: `alert('파일 첨부를 위한 공유 폴터 설정이 필요합니다.')` → 조기 반환
- 설정된 경우: `window.whisperAPI.sendFileAttachment()` 호출 → 에러 시 alert

**레이아웃 구조**:
```
<div className="flex h-screen w-screen">
  <Sidebar />          # 왼쪽: 피어/방 목록
  <main>
    {activeRoom ? <ChatView /> : <EmptyState />}  # 중앙: 대화 화면
    {transfers.length > 0 && <TransferToast />}   # 우측 하단: 전송 진행
  </main>
  {modals...}          # 조건부 모달 렌더링
</div>
```

### 7.3 appStore.ts — Zustand 상태 관리

**위치**: `src/renderer/stores/appStore.ts` (137줄)

**상태 트리**:
```typescript
AppState {
  localPeerId: string
  localNickname: string
  sharedFolder: string | null
  peers: Peer[]
  rooms: Room[]              # 각 Room에 messages: ChatMessage[] 포함
  activeRoomId: string | null
  transfers: FileTransfer[]
  unreadCounts: Record<roomId, number>
}
```

**액션**:
- `setPeers`, `setRooms`, `addRoom`
- `addMessage` → 대상 Room의 messages 배열에 추가
- `setActiveRoom`, `incrementUnread`, `clearUnread`
- `addTransfer`, `updateTransfer`, `removeTransfer`
- `updateMessageAttachment` → 다운로드 완료 후 localPath/dataUrl 업데이트

### 7.4 컴포넌트별 상세 역할

#### Sidebar.tsx (178줄)
- **상단**: 앱 타이틀 + 버전 + 닉네임 버튼
- **My Address 섹션**: 로컬 IP, TCP 포트, discovery 포트 표시 (bg-gray-900/50 박스). `window.whisperAPI.getLocalInfo()` 호출
- **Network Peers 섹션**: 피어 목록 + 🔄(새로고침) + +(수동연결). 각 피어 행에 📁(공유폴터 탐색) 버튼. **피어의 IP/포트는 노출되지 않음** (익명성 유지)
- **My Rooms 섹션**: 내가 참여 중인 방 목록. 활성 방 하이라이트 + unread 배지
- **Discovered Rooms 섹션**: 피어들이 가진 방 중 내가 참여하지 않은 방 표시. 클릭 시 join 요청
- **하단**: Shared Folder 토글 + Change Folder 버튼

#### ChatView.tsx (154줄)
- **헤더**: 방 이름 + 참여자 수 + 파일 첨부 버튼
- **메시지 영역**: `room.messages.map()`으로 렌더링
  - 내 메시지: 우측, emerald-700 배경
  - 타인 메시지: 좌측, gray-700 배경
  - **이미지 첨부**: dataUrl 기반 inline 썸네일 (jpg/png/gif/webp/bmp)
  - **일반 파일**: 다운로드 버튼 (수신자) / ✓ 받음 표시 (이미 다운로드)
- **입력 영역**: auto-resize textarea. Enter(한글 조합 중 아닐 때) 전송, Shift+Enter 줄바꿈
- **자동 스크롤**: `bottomRef`로 메시지 추가 시 하단으로 스크롤

#### CreateRoomModal.tsx (49줄)
- 방 이름 입력 + Public/Private 토글
- Private 선택 시 비밀번호 입력 필드 노출
- `window.whisperAPI.createRoom()` 호출

#### JoinRoomModal.tsx (54줄)
- Private 방 참여 시 비밀번호 입력 모달
- Public 방은 모달 없이 바로 참여

#### NicknameModal.tsx (34줄)
- 첫 실행 또는 닉네임 수정 시 표시
- 빈 값 불가, Enter 키 지원

#### ManualConnectModal.tsx (40줄)
- IP + TCP 포트 입력으로 수동 피어 연결

#### SharedFileBrowser.tsx (214줄)
- 피어의 공유 폴터 탐색 모달
- **브레드크럼**: 상위 폴터 이동 가능
- **파일 목록**: checkbox 다중 선택, 폴터는 "열기" 버튼
- **다운로드**: `selectDownloadFolder()`로 대상 경로 선택 후 다중 다운로드

---

## 8. IPC 채널 완전 맵

### 8.1 Renderer → Main (invoke)

```
┌─────────────────────────────────┬─────────────────────────────────────────────┐
│ 채널                            │ 처리 로직                                    │
├─────────────────────────────────┼─────────────────────────────────────────────┤
│ app:get-config                  │ loadConfig() → JSON 반환                     │
│ app:get-version                 │ package.json version 읽기                    │
│ app:get-local-info              │ network.getLocalIp/tcpPort/discoveryPort 반환 │
│ app:set-nickname                │ saveConfig() + network.updateNickname()      │
│ net:create-room                 │ network.createRoom() → Room 객체 반환        │
│ net:join-room                   │ network.joinRoom()                           │
│ net:send-text                   │ network.sendText()                           │
│ net:send-file-attachment        │ dialog.showOpenDialog → 10MB 검증 → 복사     │
│                                 → SHA-256 체크섬 → network.sendFileAttachment │
│ net:download-attachment         │ HTTP GET peer의 /whisper/share/... → 저장    │
│ net:get-peers                   │ network.getPeers()                           │
│ net:get-rooms                   │ network.getRooms() (members Set → Array)     │
│ net:connect-peer                │ network.connectPeer(ip, port)                │
│ net:refresh-peers               │ discovery.refreshPeers()                     │
│ net:offer-file                  │ dialog.showOpenDialog → network.offerFile()  │
│                                 → setTimeout → sendFileChunks()              │
│ net:accept-file                 │ dialog.showSaveDialog → writeStream 생성     │
│                                 → activeTransfers에 등록                      │
│ net:cancel-transfer             │ writeStream.destroy + 파일 삭제 + Map 삭제   │
│ app:set-shared-folder           │ dialog.showOpenDialog → saveConfig + setPath │
│ app:get-shared-folder           │ loadConfig().sharedPath                      │
│ app:select-download-folder      │ dialog.showOpenDialog (directory)            │
│ app:open-file                   │ shell.openPath()                             │
│ app:show-in-folder              │ shell.showItemInFolder()                     │
│ net:list-peer-files             │ HTTP GET /whisper/share?path=...             │
│ net:download-peer-files         │ HTTP GET 반복 → destDir에 저장               │
│ app:set-badge-count             │ macOS dock.setBadge / Linux setBadgeCount    │
│ app:set-badge-overlay           │ Windows setOverlayIcon (nativeImage)         │
│ app:renderer-ready              │ network:local 전송 + refreshPeers()          │
└─────────────────────────────────┴─────────────────────────────────────────────┘
```

### 8.2 Main → Renderer (push via webContents.send)

```
┌──────────────────┬──────────────────────────────────────────────────────────┐
│ 채널             │ 처리 로직                                                │
├──────────────────┼──────────────────────────────────────────────────────────┤
│ network:peers    │ App.tsx → setPeers()                                     │
│ network:message  │ App.tsx → addMessage() + incrementUnread()               │
│ network:file:offer│ App.tsx → confirm() → acceptFile() / 무시               │
│ network:file:chunk│ index.ts → writeStream.write() + file:progress emit    │
│ network:local    │ App.tsx → setLocalPeerId/setLocalNickname                │
│ file:progress    │ App.tsx → updateTransfer()                               │
│ file:complete    │ App.tsx → updateTransfer('complete') → 4초 후 remove     │
└──────────────────┴──────────────────────────────────────────────────────────┘
```

---

## 9. 네트워크 프로토콜 상세

### 9.1 TCP 메시지 포맷

```
┌─────────────┬─────────────────────────────┐
│ 4 bytes     │ N bytes                     │
│ Length (BE) │ JSON (ProtocolMessage)      │
└─────────────┴─────────────────────────────┘
```

- **Length**: UInt32 Big Endian. JSON 문자열의 UTF-8 바이트 길이
- **JSON**: `ProtocolMessage` 직렬화
- **스트리밍**: `decodeMessages()`가 버퍼에 남은 잘린 메시지(remainder)를 보관하여 다음 `data` 이벤트와 결합

### 9.2 Gossip Relay 메커니즘

```
[Sender A] ──text_message──> [Receiver B]
                                  │
                    broadcastToRoom(roomId, msg, senderA)
                                  │
                    ├─> [Member C] (1/3)
                    ├─> [Member D] (2/3)
                    └─> [Member E] (3/3)
                          │
                [E]도 동일하게 3명에게 relay
```

- **목적**: 대규모 방에서 모든 멤버에게 직접 전송 시 네트워크 오버로드 방지
- **Fanout**: 고정값 3
- **Deduplication**: `seenMessages: Set<string>`으로 messageId 기반 중복 제거. 10,000개 초과 시 절반 삭제

### 9.3 방 참여 흐름

```
[새 참여자]                              [방 소유자/멤버]
    │                                          │
    ├── join_room {roomId, passwordHash?} ────>│
    │                                          │
    │<─ room_members {members, name, type} ────│ (broadcast)
    │                                          │
    │<─ text_message (이전 메시지는 없음)       │ (휘발성)
```

- 비밀방: `passwordHash`가 `room.passwordHash`와 일치해야 `members.add()`
- 불일치 시: `leave_room {reason: 'wrong_password'}` 전송

---

## 10. 파일 전송 흐름

### 10.1 대화방 파일 첨부 (Shared Folder 기반)

```
[Sender]
  1. Renderer: sharedFolder 미설정 시 alert로 사전 차단 (App.tsx)
  2. dialog.showOpenDialog → 파일 선택
  3. 10MB 초과 검증
  4. 파일을 sharedPath/_roomsFiles/{roomId}/{messageId}/ 에 복사
  4. SHA-256 체크섬 생성
  5. 이미지면 dataUrl 생성 (base64)
  6. network.sendFileAttachment() → file_attachment 메시지 broadcast

[Receiver]
  1. file_attachment 메시지 수신 → ChatView에 📎 표시
  2. 사용자 "다운로드" 클릭
  3. HTTP GET peer의 /whisper/share/_roomsFiles/{roomId}/{messageId}/{fileName}
  4. 수신 완료 후 dataUrl 생성 → 이미지 썸네일 표시
```

### 10.2 1:1 직접 파일 전송 (TCP 청크)

```
[Sender]                                  [Receiver]
   │                                         │
   ├── file_offer {transferId, fileName} ───>│  (Renderer confirm)
   │                                         │
   │<──────────────── accept ────────────────│  (dialog.saveDialog)
   │                                         │
   ├── file_chunk (64KB, base64) ──────────>│  (writeStream.write)
   ├── file_chunk ─────────────────────────>│
   ...                                       ...
   │                                         │
   │  file:progress (upload) ──────────────>│  file:progress (download)
   │                                         │
   └── [stream end] ───────────────────────>│  file:complete
```

- **청크 크기**: 64KB
- **딜레이**: 청크당 5ms (flooding 방지)
- **취소**: `net:cancel-transfer` → writeStream.destroy + 파일 삭제

---

## 11. 보안 모델

| 항목 | 구현 |
|------|------|
| **메시지 저장** | 메모리 only. 앱 종료 시 `fs.rmSync(_roomsFiles)`로 삭제 |
| **일반방 암호화** | `deriveRoomKey(roomId)` → AES-256-GCM. roomId가 키 소스 |
| **비밀방 암호화** | `deriveKey(password, roomId)` (PBKDF2 10만 회) → AES-256-GCM |
| **비밀번호 검증** | SHA-256 해시 비교. 네트워크에는 해시만 전송 |
| **공유 폴터 접근** | `path.resolve()` 기반. `resolvedTarget.startsWith(resolvedShared)` |
| **Path Traversal** | `../` 등 상위 디렉토리 접근 403 반환 |
| **파일 첨부 제한** | 10MB 초과 시 dialog 차단 |
| **Electron 보안** | `contextIsolation: true`, `nodeIntegration: false`, preload 브리지 |

---

## 12. 빌드 & 설정

### 12.1 npm Scripts

| 스크립트 | 동작 |
|----------|------|
| `npm run dev` | electron-vite dev (HMR, DevTools 자동) |
| `npm run build` | tsc --noEmit + electron-vite build → out/ |
| `npm start` | build + electron out/main/index.js |
| `npm run dist` | build + electron-builder → dist/ |
| `npm run typecheck` | tsc --noEmit (타입 검사만) |
| `npm run preview` | electron-vite preview |

### 12.2 Path Alias (tsconfig.json)

```json
{
  "@main/*": ["src/main/*"],
  "@preload/*": ["src/preload/*"],
  "@renderer/*": ["src/renderer/*"]
}
```

### 12.3 electron.vite.config.ts

- **main**: `externalizeDepsPlugin()` + `@main` alias
- **preload**: `externalizeDepsPlugin()` + `@preload` alias
- **renderer**: `@renderer` alias + `@vitejs/plugin-react`

---

## 13. 테스트

**프레임워크**: Playwright (E2E)

**테스트 파일**: `tests/e2e/app.spec.ts` (33줄, 2개 테스트)

| 테스트 | 내용 |
|--------|------|
| 앱 실행 및 메인 화면 | Electron 앱 실행 → "Whisper Net" 타이틀 가시성 확인 |
| 닉네임 입력 후 진입 | 닉네임 모달 → "TestUser" 입력 → 사이드바에 표시 확인 |

**Playwright 설정**:
- `fullyParallel: false`, `workers: 1` (Electron 단일 인스턴스)
- `trace: 'on-first-retry'`

---

## 14. 유지보수 & 신규 기능 개발 가이드

### 14.1 "새로운 메시지 타입 추가" 시 수정 파일

| 순서 | 파일 | 수정 내용 |
|------|------|----------|
| 1 | `src/main/network/protocol.ts` | `MessageType` union에 추가, Payload 인터페이스 정의 |
| 2 | `src/main/network/NetworkManager.ts` | `handleMessage()`에 case 추가 |
| 3 | `src/main/index.ts` | 필요시 IPC 핸들러 추가, Renderer 이벤트 추가 |
| 4 | `src/preload/index.ts` | invoke/on 메서드 노출 |
| 5 | `src/renderer/stores/appStore.ts` | 상태/액션 추가 |
| 6 | `src/renderer/App.tsx` | 이벤트 구독 및 핸들러 추가 |
| 7 | `src/renderer/components/*.tsx` | UI 반영 |

### 14.2 "새로운 네트워크 발견 방식 추가" 시 수정 파일

| 순서 | 파일 | 수정 내용 |
|------|------|----------|
| 1 | `src/main/network/` | 새 발견 클래스 생성 (EventEmitter 상속) |
| 2 | `src/main/network/DiscoveryManager.ts` | 새 클래스 인스턴스화 및 이벤트 연결 |

### 14.3 "UI 컴포넌트 수정/추가" 시 수정 파일

| 순서 | 파일 | 수정 내용 |
|------|------|----------|
| 1 | `src/renderer/components/` | 새 컴포넌트 작성 또는 기존 수정 |
| 2 | `src/renderer/App.tsx` | 컴포넌트 임포트 및 상태 연결 |
| 3 | `src/renderer/stores/appStore.ts` | 필요시 상태/액션 추가 |

### 14.4 "암호화 방식 변경" 시 수정 파일

| 순서 | 파일 | 수정 내용 |
|------|------|----------|
| 1 | `src/main/network/crypto.ts` | 알고리즘/파라미터 수정 |
| 2 | `src/main/network/NetworkManager.ts` | `createRoom()`, `joinRoom()` 등에서 키 파생 호출 확인 |

### 14.5 "빌드/배포 설정 변경" 시 수정 파일

| 항목 | 파일 |
|------|------|
| 앱 ID, 이름, 아이콘 | `package.json` (build 섹션) |
| 플랫폼별 배포 형식 | `package.json` (mac/win/linux target) |
| Vite 설정 | `electron.vite.config.ts` |
| TypeScript 설정 | `tsconfig.json` |

### 14.6 버그 수정 우선 참조 표

| 증상 | 의심 파일 | 원인 |
|------|----------|------|
| 피어가 보이지 않음 | `MdnsDiscovery.ts`, `DiscoveryManager.ts` | mDNS 멀티캐스트 차단 또는 Bonjour 이슈 |
| 메시지가 중복 수신됨 | `NetworkManager.ts` | `seenMessages` Set 미동작 또는 초기화 |
| 파일 전송이 끊김 | `index.ts` (sendFileChunks), `TcpClient.ts` | 소켓 destroy, 청크 누락 |
| 비밀방 접근 불가 | `NetworkManager.ts` (join_room 핸들러) | passwordHash 불일치 |
| 공유 폴터 접근 거부 | `TcpDiscovery.ts` (handleShareList) | Path Traversal 방지 로직 |
| 닉네임 저장 안 됨 | `config.ts`, `index.ts` | 설정 파일 경로 또는 권한 |
| UI 깨짐/스타일 이슈 | `tailwind.config.js`, `index.css` | content 경로 또는 클래스 오류 |
| 첨부 이미지 미리보기 안 됨 | `ChatView.tsx`, `index.ts` | dataUrl 미생성 또는 MIME 타입 |
| 트레이 아이콘 안 보임 / 닫기 시 종료됨 | `index.ts` (`createTray`, `close` 이벤트) | `build/icon.png` 경로 누락 또는 `isQuitting` 플래그 미설정 |

---

## 15. 데이터 흐름 요약 다이어그램

### 텍스트 메시지 전송 (전체 흐름)

```
[사용자 Enter]        [Renderer]              [Preload]         [Main: index.ts]     [NetworkManager]
     │                    │                       │                    │                    │
     │── ChatView.send() ─>│                     │                    │                    │
     │                    │── window.whisperAPI.sendText() ──>│       │                    │
     │                    │                       │── ipcRenderer.invoke('net:send-text')─>│
     │                    │                       │                    │── network.sendText()│
     │                    │                       │                    │                    │
     │                    │                       │                    │<── encrypt(content) │
     │                    │                       │                    │                    │
     │                    │                       │                    │<── broadcastToRoom()│
     │                    │                       │                    │                    │
     │                    │                       │                    │── server.send() ──>│
     │                    │                       │                    │── client.send() ──>│
     │                    │                       │                    │                    │
     │                    │<── 'network:message' ─│<── webContents.send()                   │
     │                    │                       │                    │                    │
     │<── addMessage() ───│                       │                    │                    │
     │                    │                       │                    │                    │
[화면에 즉시 표시]      [Zustand 업데이트]        [IPC push]          [이벤트 emit]         [TCP 전송]
```

### 피어 발견 (전체 흐름)

```
[앱 시작]
  │
  ├── DiscoveryManager.start()
  │     ├── TcpDiscovery.start() ──> HTTP 서버 리슨 (8080~8083)
  │     └── MdnsDiscovery.start()
  │           ├── bonjour.publish() ──> 자신을 mDNS에 등록
  │           └── bonjour.find() ──> _whisper._tcp 서비스 탐색
  │
  └── peer 발견 시:
        MdnsDiscovery ──> 'peer:found' ──> DiscoveryManager.handlePeer()
                                            ├── peers Map 업데이트
                                            ├── 'peer:joined' / 'peer:updated' emit
                                            └── NetworkManager에서 client.connect(ip, port)
                                                  ├── TcpClient 연결 성공
                                                  └── discover_ack 전송 (양방향 소켓 등록)
```

---

*이 문서는 코드 리뷰 및 신규 개발자 온보딩을 위해 작성되었습니다. 프로젝트 구조나 코드가 변경될 때 이 문서도 함께 업데이트해 주세요.*
