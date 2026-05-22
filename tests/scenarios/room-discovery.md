# Room Discovery 회귀 시나리오

Phase 1+ 리팩토링 후 수동/자동 테스트 기준입니다.

> **자동화**: `tests/e2e/room-discovery.spec.ts` (Playwright, `npm run test:e2e`)  
> **문서**: [docs/E2E_VISUAL_REVIEW_AUTOMATION.md](../docs/E2E_VISUAL_REVIEW_AUTOMATION.md), [docs/E2E_EXISTING_ELECTRON_PROJECTS.md](../docs/E2E_EXISTING_ELECTRON_PROJECTS.md)  
> E2E 실행 전 `npm run build` 필요. 2인스턴스 테스트는 `WHISPER_E2E=1` 환경에서 `--user-data-dir` 분리 launch.

## 시나리오 1: A 선행 — 방 생성 후 B 접속 (핵심)

1. A, B 같은 LAN에서 Whisper Net 실행
2. A: 닉네임 설정 → Public 방 "Test Room" 생성
3. B: 닉네임 설정 → Network Peers에 A 표시 확인
4. **기대**: B Sidebar **Discovered Rooms**에 "Test Room" 표시 (🔄 불필요)
5. B: 방 클릭 → join → A와 메시지 송수신

## 시나리오 2: B 선행 — A가 나중에 방 생성

1. A, B 모두 실행, 서로 Peers에 표시
2. A: 방 생성
3. **기대**: B Discovered Rooms에 즉시(또는 수 초 내) 표시

## 시나리오 3: 🔄 Fallback

1. 시나리오 1에서 Discovered Rooms가 비어 있으면 🔄 클릭
2. **기대**: HTTP `/whisper/peers`로 방 목록 표시

## 시나리오 4: 수동 IP 연결

1. mDNS 차단 환경 또는 Manual Connect로 A IP:TCP 포트 연결
2. A에 방이 있으면 Discovered Rooms 표시

## 시나리오 5: 비밀방

1. A: Private 방 생성 (비밀번호 설정)
2. B: Discovered Rooms에 🔒 표시 → join → 비밀번호 입력
3. 틀린 비밀번호 → 거부 알림

## 회귀 (기존 기능)

- [ ] 텍스트 메시지 Gossip relay
- [ ] 파일 첨부 (10MB 이하)
- [ ] 공유 폴더 탐색/다운로드
- [ ] 닉네임 변경 동기화
- [ ] 앱 종료 시 메시지 휘발
