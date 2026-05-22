import { test, expect } from '@playwright/test'
import { launchWhisperApp, closeWhisperApp } from './helpers/electron-app'

test('앱이 실행되고 메인 화면이 표시된다', async () => {
  const { app, page, userDataDir } = await launchWhisperApp('smoke')
  try {
    await expect(page.locator('text=Whisper Net').first()).toBeVisible()
  } finally {
    await closeWhisperApp(app, userDataDir)
  }
})

test('닉네임 입력 후 메인 화면 진입', async () => {
  const { app, page, userDataDir } = await launchWhisperApp('nickname')
  try {
    const modal = page.getByRole('heading', { name: '설정' })
    if (await modal.isVisible().catch(() => false)) {
      await page.getByPlaceholder('예: 김개발').fill('TestUser')
      await page.getByRole('button', { name: '시작하기' }).click()
    }
    await expect(page.getByRole('button', { name: 'TestUser' })).toBeVisible()
  } finally {
    await closeWhisperApp(app, userDataDir)
  }
})
