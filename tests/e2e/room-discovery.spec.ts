import { test, expect } from '@playwright/test'
import {
  launchWhisperApp,
  closeWhisperApp,
  ensureNickname,
  ensurePeersConnected,
  createPublicRoom,
  createPrivateRoom,
  waitForDiscoveredRoom,
  joinDiscoveredPublicRoom,
  joinDiscoveredPrivateRoom,
  getLocalAddress,
  manualConnect,
  waitForPeer,
  refreshPeers,
} from './helpers/electron-app'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test('A가 방 생성 → B가 Discovered Rooms에서 발견하고 join', async () => {
  const roomName = `E2E-Public-${Date.now()}`
  const a = await launchWhisperApp('a1')
  const b = await launchWhisperApp('b1')

  try {
    await ensureNickname(a.page, 'PeerA')
    await ensureNickname(b.page, 'PeerB')
    await ensurePeersConnected(a.page, b.page, 'PeerA', 'PeerB')

    await createPublicRoom(a.page, roomName)
    await waitForDiscoveredRoom(b.page, roomName)
    await joinDiscoveredPublicRoom(b.page, roomName)

    await expect(b.page.getByRole('heading', { name: roomName })).toBeVisible({ timeout: 15000 })

    const message = `hello-${Date.now()}`
    await b.page.getByPlaceholder('메시지를 입력하세요...').fill(message)
    await b.page.getByRole('button', { name: '전송' }).click()
    await expect(a.page.getByText(message)).toBeVisible({ timeout: 20000 })
  } finally {
    await closeWhisperApp(a.app, a.userDataDir)
    await closeWhisperApp(b.app, b.userDataDir)
  }
})

test('B가 먼저 실행 중일 때 A가 방 생성하면 B에 표시', async () => {
  const roomName = `E2E-Late-${Date.now()}`
  const a = await launchWhisperApp('a2')
  const b = await launchWhisperApp('b2')

  try {
    await ensureNickname(a.page, 'PeerA')
    await ensureNickname(b.page, 'PeerB')
    await ensurePeersConnected(a.page, b.page, 'PeerA', 'PeerB')

    await expect(b.page.locator('aside li').filter({ hasText: roomName })).toHaveCount(0)

    await createPublicRoom(a.page, roomName)
    await waitForDiscoveredRoom(b.page, roomName)
  } finally {
    await closeWhisperApp(a.app, a.userDataDir)
    await closeWhisperApp(b.app, b.userDataDir)
  }
})

test('수동 IP 연결 후 Discovered Rooms 동기화', async () => {
  const roomName = `E2E-Manual-${Date.now()}`
  const a = await launchWhisperApp('a3')
  const b = await launchWhisperApp('b3')

  try {
    await ensureNickname(a.page, 'PeerA')
    await ensureNickname(b.page, 'PeerB')
    await createPublicRoom(a.page, roomName)

    const addr = await getLocalAddress(a.page)
    await manualConnect(b.page, addr.ip, addr.port)
    await waitForPeer(b.page, 'PeerA', 20000)

    await waitForDiscoveredRoom(b.page, roomName, 30000)
  } finally {
    await closeWhisperApp(a.app, a.userDataDir)
    await closeWhisperApp(b.app, b.userDataDir)
  }
})

test('🔄 refresh fallback으로 Discovered Rooms 표시', async () => {
  const roomName = `E2E-Refresh-${Date.now()}`
  const a = await launchWhisperApp('a4')
  const b = await launchWhisperApp('b4')

  try {
    await ensureNickname(a.page, 'PeerA')
    await ensureNickname(b.page, 'PeerB')
    await createPublicRoom(a.page, roomName)

    const addr = await getLocalAddress(a.page)
    await manualConnect(b.page, addr.ip, addr.port)
    await waitForPeer(b.page, 'PeerA', 20000)

    await refreshPeers(b.page)
    await waitForDiscoveredRoom(b.page, roomName, 30000)
  } finally {
    await closeWhisperApp(a.app, a.userDataDir)
    await closeWhisperApp(b.app, b.userDataDir)
  }
})

test('비밀방 — 잘못된 비밀번호 거부, 올바른 비밀번호 join', async () => {
  const roomName = `E2E-Private-${Date.now()}`
  const password = 'secret-e2e-pass'
  const a = await launchWhisperApp('a5')
  const b = await launchWhisperApp('b5')

  try {
    await ensureNickname(a.page, 'PeerA')
    await ensureNickname(b.page, 'PeerB')
    await ensurePeersConnected(a.page, b.page, 'PeerA', 'PeerB')

    await createPrivateRoom(a.page, roomName, password)
    await waitForDiscoveredRoom(b.page, roomName)

    await joinDiscoveredPrivateRoom(b.page, roomName, 'wrong-password')
    await expect(b.page.getByText('비밀번호가 틀렸습니다.')).toBeVisible({ timeout: 15000 })
    await b.page.getByRole('button', { name: '확인' }).click()

    await joinDiscoveredPrivateRoom(b.page, roomName, password)
    await expect(b.page.getByRole('heading', { name: roomName })).toBeVisible({ timeout: 15000 })
  } finally {
    await closeWhisperApp(a.app, a.userDataDir)
    await closeWhisperApp(b.app, b.userDataDir)
  }
})
