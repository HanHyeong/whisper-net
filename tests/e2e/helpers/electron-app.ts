import { _electron as electron, Page, ElectronApplication, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

const MAIN_PATH = path.join(__dirname, '../../../out/main/index.js')

async function getAppPage(app: ElectronApplication): Promise<Page> {
  const page = await app.waitForEvent('window', {
    predicate: async (w) => {
      const url = w.url()
      return !url.startsWith('devtools://') && url !== 'about:blank'
    },
    timeout: 30000,
  })
  await page.waitForLoadState('domcontentloaded')
  return page
}

export async function launchWhisperApp(instanceId: string): Promise<{
  app: ElectronApplication
  page: Page
  userDataDir: string
}> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `whisper-e2e-${instanceId}-`))
  const app = await electron.launch({
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, WHISPER_E2E: '1' },
  })
  const page = await getAppPage(app)
  await expect(page.locator('text=Whisper Net').first()).toBeVisible({ timeout: 15000 })
  return { app, page, userDataDir }
}

export async function closeWhisperApp(app: ElectronApplication, userDataDir: string) {
  try {
    await app.evaluate(({ app: electronApp }) => {
      electronApp.exit(0)
    })
  } catch {
    // already closed
  }
  await app.close().catch(() => {})
  fs.rmSync(userDataDir, { recursive: true, force: true })
}

export async function ensureNickname(page: Page, nickname: string) {
  const settingsHeading = page.getByRole('heading', { name: '설정' })
  if (await settingsHeading.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.getByPlaceholder('예: 김개발').fill(nickname)
    await page.getByRole('button', { name: '시작하기' }).click()
  }
  await expect(page.getByRole('button', { name: nickname })).toBeVisible({ timeout: 10000 })
}

export async function getLocalAddress(page: Page): Promise<{ ip: string; port: number }> {
  const addressEl = page.locator('span.text-emerald-400').filter({ hasText: /^\d+\.\d+\.\d+\.\d+:\d+$/ }).first()
  await expect(addressEl).toBeVisible({ timeout: 15000 })
  const text = (await addressEl.textContent()) ?? ''
  const [ip, portStr] = text.split(':')
  return { ip, port: parseInt(portStr, 10) }
}

export async function waitForPeer(page: Page, peerNickname: string, timeout = 30000) {
  await expect(page.locator('aside li').filter({ hasText: peerNickname }).first()).toBeVisible({ timeout })
}

export async function manualConnect(page: Page, ip: string, port: number) {
  await page.getByTitle('manual connect').click()
  await page.getByRole('heading', { name: '수동 연결' }).waitFor()
  await page.getByPlaceholder('10.0.0.5').fill(ip)
  await page.locator('input').nth(1).fill(String(port))
  await page.getByRole('button', { name: '연결' }).click()
}

/** mDNS 대기 후 실패 시 수동 TCP 연결로 피어 동기화 */
export async function ensurePeersConnected(
  pageA: Page,
  pageB: Page,
  nameA: string,
  nameB: string
) {
  try {
    await waitForPeer(pageB, nameA, 12000)
  } catch {
    const addr = await getLocalAddress(pageA)
    await manualConnect(pageB, addr.ip, addr.port)
    await waitForPeer(pageB, nameA, 20000)
  }
  await waitForPeer(pageA, nameB, 20000)
}

export async function createPublicRoom(page: Page, roomName: string) {
  await page.getByRole('button', { name: '+ New Room' }).click()
  await page.getByRole('heading', { name: '새 대화방 만들기' }).waitFor()
  await page.locator('input').first().fill(roomName)
  await page.getByRole('button', { name: '만들기' }).click()
  await expect(page.locator('aside').getByText(roomName, { exact: true }).first()).toBeVisible({ timeout: 10000 })
}

export async function createPrivateRoom(page: Page, roomName: string, password: string) {
  await page.getByRole('button', { name: '+ New Room' }).click()
  await page.getByRole('heading', { name: '새 대화방 만들기' }).waitFor()
  await page.locator('input').first().fill(roomName)
  await page.getByRole('button', { name: '비밀형' }).click()
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: '만들기' }).click()
  await expect(page.locator('aside').getByText(roomName, { exact: true }).first()).toBeVisible({ timeout: 10000 })
}

export async function waitForDiscoveredRoom(page: Page, roomName: string, timeout = 30000) {
  await expect(page.getByText('Discovered Rooms')).toBeVisible({ timeout })
  await expect(
    page.locator('aside li').filter({ hasText: roomName }).filter({ hasText: 'Join' }).first()
  ).toBeVisible({ timeout })
}

export async function joinDiscoveredPublicRoom(page: Page, roomName: string) {
  await page.locator('aside li').filter({ hasText: roomName }).filter({ hasText: 'Join' }).first().click()
}

export async function joinDiscoveredPrivateRoom(page: Page, roomName: string, password: string) {
  await page.locator('aside li').filter({ hasText: roomName }).filter({ hasText: 'Join' }).first().click()
  await page.getByRole('heading', { name: 'Join Room' }).waitFor()
  await page.getByPlaceholder('Enter password').fill(password)
  await page.getByRole('button', { name: 'Join' }).click()
}

export async function refreshPeers(page: Page) {
  await page.getByTitle('refresh peers').click()
}
