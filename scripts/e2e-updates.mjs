import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron, chromium } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entry = process.argv.find((arg) => arg.startsWith('--entry='))?.slice('--entry='.length)
if (entry) assert(fs.statSync(path.resolve(entry)).isFile(), 'E2E entry must be an existing file')
// Reuse a running Vite renderer for styling checks; never launch Electron or install updates.
const visualUrl = process.argv
  .find((arg) => arg.startsWith('--visual-only='))
  ?.slice('--visual-only='.length)
if (visualUrl) {
  await inspectLayout(visualUrl)
  process.exit(0)
}

async function inspectLayout(url) {
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-updates-visual-'))
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const failures = []
  try {
    for (const scenario of [
      { name: 'zh-light', language: 'zh-CN', theme: 'light', available: true },
      { name: 'zh-ready', language: 'zh-CN', theme: 'light' },
      { name: 'en-ready-narrow', language: 'en', theme: 'light', narrow: true },
      { name: 'en-light', language: 'en', theme: 'light', available: true },
      { name: 'zh-dark', language: 'zh-CN', theme: 'dark' },
      { name: 'en-dark', language: 'en', theme: 'dark' },
      { name: 'en-manual-narrow', language: 'en', theme: 'light', manual: true, narrow: true },
      { name: 'zh-long-notes', language: 'zh-CN', theme: 'light', long: true, narrow: true },
      { name: 'en-long-notes-dark', language: 'en', theme: 'dark', long: true, narrow: true },
      { name: 'en-unbroken-notes', language: 'en', theme: 'light', unbroken: true, narrow: true },
      { name: 'en-downloading', language: 'en', theme: 'light', downloading: true },
      { name: 'zh-up-to-date', language: 'zh-CN', theme: 'light', check: 'up-to-date' },
      { name: 'en-up-to-date', language: 'en', theme: 'light', check: 'up-to-date' },
      {
        name: 'en-up-to-date-narrow',
        language: 'en',
        theme: 'light',
        check: 'up-to-date',
        narrow: true,
      },
      { name: 'en-up-to-date-dark', language: 'en', theme: 'dark', check: 'up-to-date' },
      { name: 'zh-checking', language: 'zh-CN', theme: 'light', check: 'checking' },
      { name: 'en-check-error', language: 'en', theme: 'light', check: 'error' },
      { name: 'zh-check-error-dark', language: 'zh-CN', theme: 'dark', check: 'error' },
      { name: 'en-disabled', language: 'en', theme: 'light', check: 'disabled' },
      {
        name: 'en-disabled-narrow',
        language: 'en',
        theme: 'light',
        check: 'disabled',
        narrow: true,
      },
      {
        name: 'en-missing-installer',
        language: 'en',
        theme: 'light',
        check: 'error',
        installError: true,
        narrow: true,
      },
    ]) {
      const page = await browser.newPage({
        viewport: {
          width: scenario.narrow ? 520 : 560,
          height: scenario.check ? 260 : scenario.narrow ? 460 : 620,
        },
        deviceScaleFactor: 2,
      })
      page.on('pageerror', (error) => failures.push(error.message))
      await page.addInitScript((fixture) => {
        const release = {
          version: '2.0.5',
          date: '2026-10-22',
          notes:
            fixture.language === 'en'
              ? '## New features\n- **Melo conversations.** Ask about the document you’re reading, work on a draft, or organize files.\n- **Floating companion.** Melo stays nearby while you work.\n- **Connect Claude Code or Codex.** Sign in or connect with an API key.\n\n## Improvements\n- Edit tags directly above your document.'
              : '## 新功能\n- **Melo 对话窗口。** 在侧边打开对话，问正在读的这篇文档；切换标签时 Melo 跟着当前文件走，选中一段文字按 `⌘ L` 就能发给它。\n- **悬浮小河豚。** 收起对话后，小河豚停在窗口右下角：在工作时会游动，等你确认时会鼓起来。\n- **在对话里整理文件。** 把文件或截图拖进对话，Melo 会给出名字和存放的文件夹，你确认后才移动。\n- **连接 Claude Code 或 Codex。** 可以用账号登录，也可以填 API 密钥。\n\n## 改进\n- 标签可以在笔记顶部直接点击修改，输入时会提示已有标签。',
        }
        if (fixture.long) release.notes = `${release.notes}\n\n`.repeat(12)
        if (fixture.unbroken) release.notes = `https://example.com/${'long-path-'.repeat(180)}`
        window.api = {
          on: () => () => {},
          invoke: async (channel) => {
            if (channel === 'invoke-get-app-version')
              return { success: true, data: { version: '2.0.4' } }
            if (channel === 'invoke-get-language')
              return {
                success: true,
                data: { language: fixture.language, resolved: fixture.language },
              }
            if (channel === 'invoke-get-settings')
              return {
                success: true,
                data: { settings: { theme: fixture.theme, autoUpdate: true } },
              }
            if (channel === 'invoke-get-update-state')
              return {
                success: true,
                data: {
                  revision: 1,
                  check: fixture.check ?? 'idle',
                  release: fixture.check ? null : release,
                  installation: fixture.installError ? 'error' : 'idle',
                  download: fixture.installError
                    ? { status: 'error', version: release.version }
                    : fixture.downloading
                      ? {
                          status: 'downloading',
                          version: release.version,
                          percent: 42,
                          transferred: 34 * 1048576,
                          total: 86 * 1048576,
                        }
                      : { status: 'idle' },
                  ready:
                    fixture.check || fixture.downloading || fixture.available
                      ? null
                      : { release, install: fixture.manual ? 'manual' : 'in-app' },
                },
              }
            return { success: true }
          },
        }
      }, scenario)
      await page.goto(`${url}#updates`)
      await page.locator(scenario.check ? '.updates-window-compact' : '.updates-notes').waitFor()
      await page.evaluate(() => document.fonts.ready)
      await page.locator('.updates-heading p').filter({ hasText: '2.0.4' }).waitFor()
      await page
        .locator('.updates-actions')
        .evaluate((element) =>
          Promise.all(
            element.getAnimations({ subtree: true }).map((animation) => animation.finished),
          ),
        )
      if (scenario.check) {
        const layout = await page.evaluate(() => ({
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          verticalOverflow: document.documentElement.scrollHeight > window.innerHeight,
          footer: document.querySelector('.updates-footer').getBoundingClientRect().toJSON(),
          height: window.innerHeight,
        }))
        assert.equal(layout.horizontalOverflow, false, scenario.name)
        assert.equal(layout.verticalOverflow, false, scenario.name)
        assert(layout.footer.bottom <= layout.height, `${scenario.name}: footer is clipped`)
        if (scenario.check === 'up-to-date') assert.equal(await page.locator('button').count(), 1)
        await page.screenshot({ path: path.join(screenshots, `${scenario.name}.png`) })
        await page.close()
        continue
      }
      const layout = await page.evaluate(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON()
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          footer: box('.updates-footer'),
          ignore: document
            .querySelector('.updates-actions > .updates-ignore')
            ?.getBoundingClientRect()
            .toJSON(),
          actions: box('.updates-primary-actions'),
          status: document.querySelector('.updates-ready')?.getBoundingClientRect().toJSON(),
          content: box('.updates-content'),
          height: window.innerHeight,
        }
      })
      assert.equal(layout.overflow, false, scenario.name)
      assert(layout.footer.bottom <= layout.height, `${scenario.name}: footer is clipped`)
      if (layout.status) {
        assert(
          layout.status.right <= layout.actions.left,
          `${scenario.name}: status overlaps buttons`,
        )
        const center = (rect) => rect.y + rect.height / 2
        assert(
          Math.abs(center(layout.status) - center(layout.actions)) < 2,
          `${scenario.name}: ready status and buttons must share a row`,
        )
      }
      if (scenario.downloading || (!scenario.available && !scenario.manual)) {
        assert.equal(await page.locator('.updates-ignore').count(), 0, scenario.name)
        assert.equal(await page.locator('.updates-secondary-actions').count(), 0, scenario.name)
      }
      if (layout.ignore)
        assert(layout.ignore.right < layout.actions.left, `${scenario.name}: actions overlap`)
      assert(layout.content.height >= 100, `${scenario.name}: notes have too little room`)
      const version = await page.locator('.updates-release-meta strong').boundingBox()
      const date = await page.locator('.updates-release-meta time').boundingBox()
      assert(version && date && date.x > version.x, 'Release date must follow its version')
      assert(Math.abs(version.y - date.y) < 2, 'Version and release date must share a row')
      if (scenario.manual) {
        const guideHeading = await page.locator('#install-guide-heading').boundingBox()
        assert(guideHeading && guideHeading.y < layout.footer.top, 'Installation steps are hidden')
      }
      await page.screenshot({ path: path.join(screenshots, `${scenario.name}.png`) })
      if (scenario.long || scenario.unbroken) {
        const content = page.locator('.updates-content')
        const metrics = await content.evaluate((element) => ({
          scrollable: element.scrollHeight > element.clientHeight,
          horizontalOverflow: element.scrollWidth > element.clientWidth,
        }))
        assert(metrics.scrollable, `${scenario.name}: long notes must scroll`)
        assert.equal(metrics.horizontalOverflow, false, `${scenario.name}: notes must wrap`)
        await content.focus()
        await page.keyboard.press('End')
        await page.waitForFunction(() => document.querySelector('.updates-content').scrollTop > 0)
        await content.evaluate((element) => {
          element.scrollTop = element.scrollHeight
        })
        const afterScroll = await page.locator('.updates-footer').boundingBox()
        assert.equal(afterScroll.y, layout.footer.y, `${scenario.name}: footer must not move`)
        const link = await page.locator('.updates-notes-link').boundingBox()
        assert(link && link.y + link.height <= afterScroll.y, 'End of release notes is unreachable')
        await page.screenshot({ path: path.join(screenshots, `${scenario.name}-scrolled.png`) })
      }
      await page.close()
    }
    assert.deepEqual(failures, [])
    console.log(
      JSON.stringify({
        ok: true,
        screenshots,
        checked: 'renderer layout only; no Electron launch or installation',
      }),
    )
  } finally {
    await browser.close()
  }
}

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-updates-e2e-'))
const profile = path.join(testRoot, 'profile')
fs.mkdirSync(profile)
fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({ language: 'zh-CN' }))
const release = {
  version: '2.0.2',
  date: '2026-10-22',
  notes:
    '新增功能\n• 全新的首次使用引导\n• 支持在智能文件夹中管理文件\n\n体验改进\n• 改进编辑器大纲与快捷搜索\n• 优化更新下载和安装引导',
}
let state = {
  revision: 100,
  check: 'idle',
  release,
  download: { status: 'downloading', version: release.version, percent: 42 },
  ready: null,
  installation: 'idle',
}
let app
const errors = []

try {
  const env = { ...process.env, MELO_USER_DATA: profile, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.MELO_UPDATER_TEST
  delete env.ELECTRON_RENDERER_URL
  app = await electron.launch({
    executablePath: electronPath,
    args: [entry ? path.resolve(entry) : projectRoot],
    cwd: projectRoot,
    env,
    timeout: 30000,
  })
  const main = await app.firstWindow()
  await main.locator('.ws-opener').waitFor()
  // Exercise the real window/menu/preload; fixtures replace only update data.
  // No network download, app quit, or installation is allowed in this suite.
  await app.evaluate(({ ipcMain }, fixture) => {
    ipcMain.removeHandler('invoke-get-update-state')
    ipcMain.handle('invoke-get-update-state', () => ({ success: true, data: fixture }))
  }, state)
  const open = () =>
    app.evaluate(({ Menu }) => {
      const help = Menu.getApplicationMenu().items.find((item) => item.role === 'help')
      const check = help.submenu.items.find((item) => item.label === '检查更新')
      check.click()
    })
  const [page] = await Promise.all([app.waitForEvent('window'), open()])
  await page.waitForURL('**#updates')
  // The fixture contains a release, while the dev manager is intentionally disabled.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) =>
      item.webContents.getURL().endsWith('#updates'),
    )
    window.setMinimumSize(520, 460)
    window.setSize(560, 520)
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.locator('.updates-notes-text').waitFor()
  assert.match(await page.locator('.updates-status').innerText(), /42%/)
  await page.screenshot({ path: path.join(testRoot, 'zh-downloading.png') })
  await open()
  assert.equal(
    (await app.windows()).filter((window) => window.url().endsWith('#updates')).length,
    1,
  )
  state = {
    ...state,
    revision: 101,
    download: { status: 'idle' },
    ready: { release, install: 'manual' },
  }
  await app.evaluate(({ BrowserWindow }, fixture) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('on-update-state', fixture)
  }, state)
  await page.getByRole('button', { name: '打开安装包', exact: true }).waitFor()
  assert.match(await page.locator('.updates-guide').innerText(), /Applications/)
  await page.screenshot({ path: path.join(testRoot, 'zh-ready.png') })
  await app.evaluate(({ BrowserWindow }) => {
    const update = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().endsWith('#updates'),
    )
    update.setSize(520, 460)
    update.webContents.send('on-language-changed', { language: 'en', resolved: 'en' })
  })
  await page.getByRole('button', { name: 'Open installer', exact: true }).waitFor()
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.screenshot({ path: path.join(testRoot, 'en-dark-narrow.png') })
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  )
  const button = await page
    .getByRole('button', { name: 'Open installer', exact: true })
    .boundingBox()
  assert(button && button.y + button.height <= (await page.evaluate(() => window.innerHeight)))
  const closed = page.waitForEvent('close')
  await page.getByRole('button', { name: 'Later', exact: true }).click()
  await closed
  assert.equal(
    (await app.windows()).filter((window) => window.url().endsWith('#updates')).length,
    0,
  )
  const latest = {
    revision: 102,
    check: 'up-to-date',
    release: null,
    download: { status: 'idle' },
    ready: null,
    installation: 'idle',
  }
  await app.evaluate(({ ipcMain }, fixture) => {
    ipcMain.removeHandler('invoke-get-update-state')
    ipcMain.handle('invoke-get-update-state', () => ({ success: true, data: fixture }))
  }, latest)
  const [resultPage] = await Promise.all([app.waitForEvent('window'), open()])
  await resultPage.waitForURL('**#updates')
  const autoUpdate = resultPage.locator('.updates-auto input')
  await autoUpdate.waitFor()
  const previousAutoUpdate = await autoUpdate.isChecked()
  await autoUpdate.setChecked(!previousAutoUpdate)
  await resultPage.waitForFunction(async (expected) => {
    const result = await window.api.invoke('invoke-get-settings')
    return result.data.settings.autoUpdate === expected
  }, !previousAutoUpdate)
  await resultPage.reload()
  await resultPage.locator('.updates-auto input').waitFor()
  assert.equal(await resultPage.locator('.updates-auto input').isChecked(), !previousAutoUpdate)
  await resultPage.screenshot({ path: path.join(testRoot, 'latest-persisted-setting.png') })
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      ok: true,
      screenshots: testRoot,
      checked: [
        'single-window',
        'progress-to-install',
        'zh-light',
        'en-dark-narrow',
        'later',
        'auto-update-persistence',
      ],
      installation: 'not exercised',
    }),
  )
} finally {
  if (app) {
    await app
      .evaluate(({ app: instance }) => instance.exit(0))
      .catch((error) => console.error('Test cleanup:', error.message))
    await app.close()
  }
}
