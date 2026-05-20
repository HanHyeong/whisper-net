# Whisper Net

<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="Whisper Net Icon">
</p>

<p align="center">
  <b>서버 없는 P2P LAN 메신저</b><br>
  <i>인터넷 없이 같은 네트워크 내에서 대화하고 파일을 공유하세요</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-30.0.8-47848F?logo=electron&logoColor=white">
  <img src="https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react&logoColor=black">
  <img src="https://img.shields.io/badge/TypeScript-5.4.5-3178C6?logo=typescript&logoColor=white">
  <img src="https://img.shields.io/badge/Tailwind-3.4.3-06B6D4?logo=tailwindcss&logoColor=white">
</p>

---

## 🎯 프로젝트 소개

**Whisper Net**은 중앙 서버 없이 **완전한 P2P 방식**으로 동작하는 LAN 메신저입니다. 같은 와이파이나 유선 네트워크에 연결된 기기들끼리 자동으로 서로를 발견하고, 대화방을 만들어 메시지를 주고받으며 파일을 공유할 수 있습니다.

> 💡 **왜 Whisper Net인가?**
> - 인터넷 연결 없이 작동 (오프라인 메신저)
> - 서버 운영 비용 없음 (완전 물리적 P2P)
> - 프라이버시 보장 (메시지가 서버를 거치지 않음, E2E 암호화)
> - 파일 공유 내장 (공유 폴터 + 대화방 첨부)

---

## ✨ 주요 기능

### 💬 실시간 그룹 채팅
- **대화방 생성**: 공개방(Public) / 비밀방(Private, 비밀번호 보호)
- **Gossip Relay**: 대규모 방에서도 효율적인 메시지 전파 (fanout=3)
- **줄바꿈 지원**: Shift+Enter로 여러 줄 입력
- **안 읽은 메시지 배지**: 다른 방 메시지 수신 시 Sidebar에 알림
- **휘발성 메시지**: 앱 종료 시 메시지 자동 삭제 (보안/경량화)

### 🔐 메시지 암호화
- **비밀방**: 사용자 비밀번호 + PBKDF2(10만 회) → AES-256-GCM 키
- **일반방**: roomId 기반 키 파생 (PBKDF2) → AES-256-GCM
- **네트워크 상 암호화**: 스니퍼가 패킷을 캡처핻도 내용을 볼 수 없음
- ⚠️ 클라이언트 측 키는 완벽히 숨길 수 없습니다 (Electron 한계). 네트워크 레벨 보안에 집중합니다.

### 🔄 피어 정보 새로고침
- Sidebar의 **🔄 버튼**으로 모든 피어의 닉네임/방 목록을 HTTP로 동기화
- mDNS 발견 지연 시에도 최신 정보 획득 가능
- 이전 버전 피어와의 호환성 유지

### 🔍 자동 피어 발견
- **TCP HTTP Discovery**: 8080~8083 포트에서 피어 자동 스캔 (기본)
- **mDNS Fallback**: TCP 스캔 실패 시 Bonjour/mDNS로 fallback
- **수동 IP 연결**: 직접 IP와 포트 입력으로 접속
- **자동 재연결**: 네트워크 복구 시 피어 자동 복원

### 📁 파일 공유
- **공유 폴터**: 폴터 내 파일/하위폴터 탐색 및 다운로드
- **대화방 파일 첨부**: 10MB 이하 파일을 대화에 첨부 (URL 기반 공유)
- **이미지 썸네일**: jpg/png/gif/webp 파일은 대화 내에서 미리보기
- **클릭 실행**: 이미지는 기본 앱 열기, 일반 파일은 폴터 위치 보기

### 🏠 방 유지성
- 방장이 나가도 **멤버들이 계속 대화** 가능
- 방장 재접속 시 기존 방으로 **재가입** 가능
- 멤버십 자동 동기화 (ROOM_MEMBERS 프로토콜)

---

## 🏗️ 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                        Renderer (React)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Sidebar    │  │   ChatView   │  │ SharedFileBrowser│  │
│  │  (피어/방 목록)│  │  (대화 화면)  │  │   (공유 폴터 탐색) │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (contextBridge)
┌──────────────────────────▼──────────────────────────────────┐
│                      Main (Node.js)                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              NetworkManager (EventEmitter)            │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────┐  │  │
│  │  │ TcpServer  │  │ TcpClient  │  │ DiscoveryManager│  │  │
│  │  │ (수신 41235+)│  │ (발신)      │  │                │  │  │
│  │  └────────────┘  └────────────┘  │ ┌────────────┐ │  │  │
│  │                                    │ │TcpDiscovery│ │  │  │
│  │  ┌────────────┐  ┌────────────┐   │ │(HTTP 8080+)│ │  │  │
│  │  │   Rooms    │  │   Peers    │   │ └────────────┘ │  │  │
│  │  │  (Map)     │  │  (Map)     │   │ ┌────────────┐ │  │  │
│  │  └────────────┘  └────────────┘   │ │ MdnsDiscovery│ │  │  │
│  │                                    │ │  (fallback)  │ │  │  │
│  │  Gossip: broadcastToRoom()         │ └────────────┘ │  │  │
│  │  Dedup: seenMessages (UUID Set)    └────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 프로토콜 스택

| 레이어 | 프로토콜 | 설명 |
|--------|----------|------|
| 애플리케이션 | JSON over TCP | 길이-프리픽스 메시지 (4바이트 헤더 + JSON 페이로드) |
| 전송 | TCP | 랜덤 포트 41235+ (1:1 직접 연결) |
| 발견 | HTTP 8080~8083 | `/whisper/peers`, `/whisper/heartbeat`, `/whisper/share` |
| 폴트백 | mDNS (Bonjour) | TCP 스캔 5초 후 자동 활성화 |

---

## 🚀 시작하기

### 요구사항
- Node.js 20+
- npm
- macOS / Windows / Linux

### 설치

```bash
# 클론
git clone https://github.com/HanHyeong/whisper-net.git
cd whisper-net

# 의존성 설치
npm install
```

### 개발 모드 실행

```bash
npm run dev
```
- HMR (Hot Module Replacement) 활성화
- DevTools 자동 열림
- 개발 중 코드 수정 시 즉시 반영

### 빌드

```bash
npm run build
```
- TypeScript 타입 체크
- electron-vite로 main/preload/renderer 번들링
- 출력: `out/` 디렉토리

### 실행 (빌드 후)

```bash
npm start
```

### 📦 설치 파일 생성 (배포)

```bash
npm run dist
```

플랫폼별 출력:
- **macOS**: `dist/Whisper Net-0.1.0.dmg`
- **Windows**: `dist/Whisper Net Setup 0.1.0.exe`
- **Linux**: `dist/Whisper Net-0.1.0.AppImage`

---

## 🎮 사용 방법

### 1. 닉네임 설정
처음 실행하면 닉네임 입력 팝업이 표시됩니다. 이 닉네임은 네트워크 내 다른 사용자에게 보입니다.

### 2. 대화방 만들기
- 사이드바 상단 **+ New Room** 클릭
- 공개방(Public): 누구나 자동 발견 및 참여
- 비밀방(Private): 비밀번호 설정 필요

### 3. 대화방 참여
- **Discovered Rooms**에서 원하는 방 클릭
- 비밀방은 비밀번호 입력 후 참여
- 참여 즉시 이전 메시지는 볼 수 없음 (휘발성)

### 4. 파일 첨부
- 대화창 상단 **📎 파일 첨부** 버튼
- 10MB 이하 파일만 첨부 가능
- 이미지는 대화 내에서 썸네일로 바로 확인
- 클릭 시 기본 앱 실행 또는 폴더 위치 보기

### 5. 공유 폴터 설정
- 사이드바 하단 **Shared Folder** 토글 ON
- 폴터 선택 후 네트워크 피어들에게 파일 공유
- 피어의 📁 버튼 클릭으로 파일/하위폴터 탐색 및 다운로드

---

## ⚙️ 설정 파일

```
~/Library/Application Support/whisper-net/whisper-config.json
```

```json
{
  "nickname": "사용자 닉네임",
  "sharedPath": "/Users/xxx/Documents/shared"
}
```

> ⚠️ **주의**: 한 PC에서 여러 인스턴스를 실행하려면 설정 파일을 백업/이동하세요. 같은 설정 파일을 공유하면 peerId 충돌이 발생할 수 있습니다.

---

## 🔒 보안

| 항목 | 정책 |
|------|------|
| **메시지 저장** | 메모리에만 저장, 디스크에 영구 저장하지 않음 |
| **메시지 암호화** | AES-256-GCM (비밀방: PBKDF2 10만 회, 일반방: roomId 기반) |
| **비밀방** | SHA-256 해시로 비밀번호 검증 |
| **공유폴터 인증** | HMAC-SHA256 요청 서명 + 1분 타임스탬프 윈도우 |
| **파일 접근** | 공유 폴터 내 `_roomsFiles/` 경로만 접근 가능 |
| **Path Traversal** | `path.resolve()` 기반 검증으로 상위 디렉토리 접근 차단 |
| **키 관리** | 모든 비밀 키는 `.env` 파일에 저장 (소스 코드에 하드코딩 없음) |

---

## 🐛 알려진 이슈

- macOS에서 mDNS 활성화 시 "컴퓨터 이름 변경" 알림이 표시될 수 있음 (무시 가능)
- DevTools에서 CSP 경고는 개발 모드 전용이며, 빌드 후 사라짐
- 같은 PC에서 다중 인스턴스 실행 시 `whisper-config.json` 충돌 가능
- 이전 버전 피어와의 교차 사용 시 암호화 메시지가 평문으로 표시될 수 있음

---

## 🛠️ 기술 스택 상세

| 분야 | 기술 |
|------|------|
| 프레임워크 | Electron 30, React 18, TypeScript 5 |
| 빌드 도구 | electron-vite, Vite 5 |
| 스타일링 | Tailwind CSS 3 |
| 상태 관리 | Zustand |
| P2P 네트워크 | TCP 소켓 (Node.js `net`), HTTP 서버 |
| 서비스 발견 | TCP HTTP 스캔 + mDNS (Bonjour) 폴트백 |
| 파일 전송 | HTTP GET (공유 폴터), TCP 청크 (1:1 직접 전송) |
| 테스트 | Playwright (E2E 스캐폴드) |

---

## 📂 프로젝트 구조

```
whisper-net/
├── build/                  # 앱 아이콘 (icon.png, icon.svg)
├── out/                    # 빌드 출력물 (electron-vite)
├── src/
│   ├── main/               # Electron 메인 프로세스
│   │   ├── index.ts        # 윈도우 생성, IPC 핸들러
│   │   ├── network/        # P2P 네트워크 코어
│   │   │   ├── NetworkManager.ts    # 방/메시지/피어 관리
│   │   │   ├── TcpDiscovery.ts      # HTTP 발견 서버
│   │   │   ├── TcpServer.ts         # TCP 수신 서버
│   │   │   ├── TcpClient.ts         # TCP 발신 클라이언트
│   │   │   ├── DiscoveryManager.ts  # TCP + mDNS 오케스트레이션
│   │   │   ├── MdnsDiscovery.ts     # mDNS 폴트백
│   │   │   ├── protocol.ts          # 메시지 타입/인코딩
│   │   │   └── crypto.ts            # PBKDF2 + AES-256-GCM + HMAC
│   │   └── utils/
│   │       └── config.ts   # 설정 파일 로드/저장
│   ├── preload/            # IPC 브리지
│   │   └── index.ts
│   └── renderer/           # React 렌더러
│       ├── App.tsx         # 메인 레이아웃
│       ├── main.tsx
│       ├── stores/
│       │   └── appStore.ts # Zustand 상태 관리
│       └── components/
│           ├── Sidebar.tsx          # 피어/방 목록
│           ├── ChatView.tsx         # 대화 화면
│           ├── JoinRoomModal.tsx    # 비밀방 참여 모달
│           ├── CreateRoomModal.tsx  # 방 생성 모달
│           ├── SharedFileBrowser.tsx# 공유 폴터 탐색기
│           ├── NicknameModal.tsx    # 닉네임 설정
│           └── ManualConnectModal.tsx
├── package.json
├── tsconfig.json
└── electron.vite.config.ts
```

---

## 📜 라이선스

MIT License

---

<p align="center">
  <sub>Built with ❤️ for offline communities</sub>
</p>
