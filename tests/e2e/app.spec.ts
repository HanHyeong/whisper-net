import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'

test('앱이 실행되고 메인 화면이 표시된다', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js')],
  })
  const page = await app.firstWindow()

  // 메인 타이틀 확인
  await expect(page.locator('text=Whisper Net')).toBeVisible()

  await app.close()
})

test('닉네임 입력 후 메인 화면 진입', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js')],
  })
  const page = await app.firstWindow()

  // 닉네임 모달이 있으면 입력
  const modal = page.locator('text=닉네임 설정')
  if (await modal.isVisible().catch(() => false)) {
    await page.fill('input[placeholder="예: 김개발"]', 'TestUser')
    await page.click('text=시작하기')
  }

  // 사이드바의 닉네임 표시 확인
  await expect(page.locator('text=TestUser')).toBeVisible()

  await app.close()
})
