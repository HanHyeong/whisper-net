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
} from './helpers/electron-app'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

test('다른 참여자 있을 때 나가기 → Discovered Rooms에 재표시', async () => {
  const roomName = `E2E-Leave-Unjoin-${Date.now()}`
  const a = await launchWhisperApp('leave-a1')
  const b = await launchWhisperApp('leave-b1')

  try {
    await ensureNickname(a.page, 'LeaveA')
    await ensureNickname(b.page, 'LeaveB')
    await ensurePeersConnected(a.page, b.page, 'LeaveA', 'LeaveB')

    await createPublicRoom(a.page, roomName)
    await waitForDiscoveredRoom(b.page, roomName)
    await joinDiscoveredPublicRoom(b.page, roomName)
    await expect(b.page.getByRole('heading', { name: roomName })).toBeVisible({ timeout: 15000 })
    await expect(b.page.getByText(/님이 참여하였습니다\./)).toBeVisible({ timeout: 10000 })

    await a.page.getByRole('button', { name: '나가기' }).click()
    await a.page.getByRole('button', { name: '나가기' }).last().click()

    await expect(
      a.page.locator('aside li').filter({ hasText: roomName }).filter({ hasNotText: 'Join' })
    ).not.toBeVisible({ timeout: 10000 })
    await expect(a.page.getByText('Discovered Rooms')).toBeVisible({ timeout: 15000 })
    await expect(
      a.page.locator('aside li').filter({ hasText: roomName }).filter({ hasText: 'Join' }).first()
    ).toBeVisible({ timeout: 20000 })

    await expect(b.page.locator('aside').getByText(roomName, { exact: true }).first()).toBeVisible({ timeout: 10000 })
    await expect(b.page.getByText(/LeaveA님이 나가셨습니다\./)).toBeVisible({ timeout: 10000 })

    await joinDiscoveredPublicRoom(a.page, roomName)
    await expect(a.page.getByRole('heading', { name: roomName })).toBeVisible({ timeout: 15000 })

    const message = `rejoin-${Date.now()}`
    await a.page.getByPlaceholder('메시지를 입력하세요...').fill(message)
    await a.page.getByRole('button', { name: '전송' }).click()
    await expect(b.page.getByText(message)).toBeVisible({ timeout: 20000 })
  } finally {
    await closeWhisperApp(a.app, a.userDataDir)
    await closeWhisperApp(b.app, b.userDataDir)
  }
})

test('혼자 남았을 때 나가기 → 방 완전 삭제', async () => {
  const roomName = `E2E-Leave-Close-${Date.now()}`
  const a = await launchWhisperApp('leave-a2')
  const b = await launchWhisperApp('leave-b2')

  try {
    await ensureNickname(a.page, 'CloseA')
    await ensureNickname(b.page, 'CloseB')
    await ensurePeersConnected(a.page, b.page, 'CloseA', 'CloseB')

    await createPublicRoom(a.page, roomName)
    await expect(a.page.getByRole('heading', { name: roomName })).toBeVisible({ timeout: 10000 })

    await a.page.getByRole('button', { name: '나가기' }).click()
    await expect(a.page.getByText('방이 삭제')).toBeVisible({ timeout: 5000 })
    await a.page.getByRole('button', { name: '나가기' }).last().click()

    await expect(
      a.page.locator('aside li').filter({ hasText: roomName }).filter({ hasNotText: 'Join' })
    ).not.toBeVisible({ timeout: 10000 })
    await expect(a.page.getByText('Discovered Rooms')).not.toBeVisible({ timeout: 5000 }).catch(() => {})

    await b.page.getByTitle('refresh peers').click()
    await expect(
      b.page.locator('aside li').filter({ hasText: roomName }).first()
    ).not.toBeVisible({ timeout: 20000 })
  } finally {
    await closeWhisperApp(a.app, a.userDataDir)
    await closeWhisperApp(b.app, b.userDataDir)
  }
})

test('비밀방 나가기 후 재참여', async () => {
  const roomName = `E2E-Leave-Private-${Date.now()}`
  const password = 'leave-test-pw'
  const a = await launchWhisperApp('leave-a3')
  const b = await launchWhisperApp('leave-b3')

  try {
    await ensureNickname(a.page, 'PrivA')
    await ensureNickname(b.page, 'PrivB')
    await ensurePeersConnected(a.page, b.page, 'PrivA', 'PrivB')

    await createPrivateRoom(a.page, roomName, password)
    await waitForDiscoveredRoom(b.page, roomName)
    await joinDiscoveredPrivateRoom(b.page, roomName, password)
    await expect(b.page.getByRole('heading', { name: roomName })).toBeVisible({ timeout: 15000 })

    await a.page.getByRole('button', { name: '나가기' }).click()
    await a.page.getByRole('button', { name: '나가기' }).last().click()

    await expect(
      a.page.locator('aside li').filter({ hasText: roomName }).filter({ hasText: 'Join' }).first()
    ).toBeVisible({ timeout: 20000 })

    await a.page.getByTitle('refresh peers').click()
    await joinDiscoveredPrivateRoom(a.page, roomName, password)
    await expect(
      a.page.locator('aside li').filter({ hasText: roomName }).filter({ hasNotText: 'Join' }).first()
    ).toBeVisible({ timeout: 30000 })
    await a.page.locator('aside li').filter({ hasText: roomName }).filter({ hasNotText: 'Join' }).first().click()
    await expect(a.page.getByRole('heading', { name: roomName })).toBeVisible({ timeout: 15000 })
  } finally {
    await closeWhisperApp(a.app, a.userDataDir)
    await closeWhisperApp(b.app, b.userDataDir)
  }
})
