import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'melo-clip-e2e-')))
const workspace = path.join(testRoot, 'workspace')
const profile = path.join(testRoot, 'profile')
const screenshotDir = process.env.MELO_E2E_SCREENSHOT_DIR
const logs = []
const gates = new Map()
let app
const title = (pathname) => `笔记与知识 ${pathname.slice(1)}`
const article = (pathname) =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title(pathname)}</title><link rel="icon" href="/brand.svg"><meta name="description" content="把收藏的资料变成自己的理解，让阅读、思考与写作靠得更近。"></head><body><article><h1>${title(pathname)}</h1>${Array.from({ length: 18 }, (_, i) => `<p>阅读与思考 ${i + 1}。保存资料只是一个开始，真正的价值来自反复阅读、建立联系，再用自己的语言把理解写下来。好的工具应该让这些事情自然发生，让内容保存在自己的文件夹里。</p>`).join('')}</article></body></html>`
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  if (pathname === '/brand.svg')
    return response
      .writeHead(200, { 'content-type': 'image/svg+xml' })
      .end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="#356ef6"/></svg>',
      )
  if (pathname === '/favicon.ico') return response.writeHead(404).end()
  await gates.get(pathname)?.promise
  if (pathname === '/error') return response.writeHead(503).end('Unavailable')
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(article(pathname))
})
function gate(pathname) {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  gates.set(pathname, { promise, release })
  return () => {
    gates.delete(pathname)
    release()
  }
}
async function waitUntil(label, check, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${label} timed out`)
}
async function run() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  for (const folder of [
    profile,
    workspace,
    path.join(workspace, 'Inbox'),
    path.join(workspace, 'Research'),
    path.join(workspace, 'Very long destination directory name'),
  ])
    fs.mkdirSync(folder, { recursive: true })
  for (let i = 0; i < 12; i++)
    fs.mkdirSync(path.join(workspace, `Folder ${i.toString().padStart(2, '0')}`))
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ lastDirectory: workspace, language: 'en' }),
  )
  fs.writeFileSync(
    path.join(workspace, 'Start.md'),
    '# Start\n\nA local fixture, without external services.\n',
  )
  const knownPath = path.join(workspace, 'Inbox', 'Existing.md')
  fs.writeFileSync(
    knownPath,
    `---\nsource: ${baseUrl}/known\ncreated: 2026-11-01T00:00:00Z\n---\n\n# Existing\n\nAn already clipped article.\n`,
  )
  const env = {
    ...process.env,
    MELO_USER_DATA: profile,
    CLAUDE_CONFIG_DIR: path.join(testRoot, 'claude'),
    CODEX_HOME: path.join(testRoot, 'codex'),
  }
  for (const key of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_RENDERER_URL',
  ])
    delete env[key]
  app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot],
    cwd: projectRoot,
    env,
    timeout: 30000,
  })
  app.process().stderr?.on('data', (chunk) => logs.push(String(chunk)))
  await app.evaluate(({ BrowserWindow, shell }) => {
    BrowserWindow.getAllWindows()[0].setSize(1280, 900)
    shell.openExternal = async () => {}
    shell.openPath = async () => ''
  })
  const page = await app.firstWindow()
  page.on('pageerror', (error) => logs.push(`[pageerror] ${error.stack}`))
  await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 30000 })
  await page
    .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'Start' }) })
    .first()
    .click()
  await page.locator('.tiptap').waitFor({ state: 'visible' })
  const input = page.locator('.pb-panel .sf-input')
  const status = page.locator('.clip-status')
  async function open(pathname) {
    if (!(await page.locator('.pb-panel').count())) await page.keyboard.press('Meta+k')
    await input.fill(`${baseUrl}${pathname}`)
    await page.locator('.clip-ctrl').waitFor({ state: 'visible' })
  }
  async function screenshot(name) {
    if (!screenshotDir) return
    fs.mkdirSync(screenshotDir, { recursive: true })
    await page.evaluate(async () => {
      await Promise.allSettled(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished),
      )
    })
    await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) })
  }
  await page.keyboard.press('Meta+k')
  assert.equal(await page.locator('.sf-tips').count(), 1)
  await open('/ready')
  await waitUntil('ready', async () => (await status.innerText()).includes('Ready to save'))
  assert.equal(await page.locator('.sf-tips, .clip-link, .clip-fav, .clip-rd-rule').count(), 0)
  assert(!(await page.locator('.clip-rd-meta').innerText()).includes('Inbox'))
  await waitUntil('preview site icon loads', () =>
    page
      .locator('.clip-rd-kicker .favicon img')
      .evaluate((node) => node.src.endsWith('/brand.svg') && node.naturalWidth > 0),
  )
  await screenshot('ready')
  await page.keyboard.press('Tab')
  const folderInput = page.locator('.clip-dest-search input')
  await folderInput.fill('Research')
  await screenshot('folder')
  await folderInput.press('Enter')
  assert.equal(await page.locator('.clip-dest-pop').count(), 0)
  assert(await input.evaluate((node) => node === document.activeElement))
  assert.equal(await page.locator('.clip-folder-trigger').innerText(), 'Research')
  await input.fill(`${baseUrl}/ready?utm_source=fixture`)
  await waitUntil('edited URL ready', async () =>
    (await status.innerText()).includes('Ready to save'),
  )
  assert.equal(await page.locator('.clip-folder-trigger').innerText(), 'Research')
  await input.fill(`${baseUrl}/ready`)
  await waitUntil('tracking removed', async () =>
    (await status.innerText()).includes('Ready to save'),
  )
  assert.equal(await page.locator('.clip-folder-trigger').innerText(), 'Research')
  await input.press('Enter')
  await waitUntil('save only', () =>
    fs.existsSync(path.join(workspace, 'Research', `${title('/ready')}.md`)),
  )
  await page.locator('.pb-panel').waitFor({ state: 'detached' })
  assert((await page.locator('.tiptap').innerText()).includes('Start'))

  const releaseQueued = gate('/queued')
  await open('/queued')
  assert.equal(await page.locator('.clip-folder-trigger').innerText(), 'Inbox')
  await screenshot('loading')
  await input.press('ArrowDown')
  await input.press('Enter')
  await waitUntil('queued save', async () =>
    (await status.innerText()).includes('Saving when ready'),
  )
  releaseQueued()
  await page.locator('.pb-panel').waitFor({ state: 'detached', timeout: 20000 })
  await waitUntil('save and open', async () =>
    (await page.locator('.tiptap').innerText()).includes(title('/queued')),
  )

  await open('/ready')
  await waitUntil('existing', async () => (await status.innerText()).includes('Already saved'))
  await waitUntil('saved site icon loads locally', () =>
    page
      .locator('.clip-rd-kicker .favicon img')
      .evaluate((node) => node.src.startsWith('app://') && node.naturalWidth > 0),
  )
  await screenshot('existing')
  await input.press('ArrowDown')
  await input.press('Enter')
  assert.equal(await page.locator('.clip-action-main').count(), 1)
  assert.equal(await page.locator('.clip-action-row.active').count(), 1)
  await input.press('Escape')

  await waitUntil(
    'source indexed',
    async () =>
      (
        await page.evaluate(
          async (url) => window.api.invoke('invoke-find-by-source', { url }),
          `${baseUrl}/known`,
        )
      ).data?.path === knownPath,
  )
  const releaseKnown = gate('/known')
  await open('/known')
  await input.press('Enter')
  releaseKnown()
  await page.locator('.pb-panel').waitFor({ state: 'detached', timeout: 20000 })
  await waitUntil('queued existing opens', async () =>
    (await page.locator('.tiptap').innerText()).includes('An already clipped article.'),
  )
  assert(!fs.existsSync(path.join(workspace, 'Research', `${title('/known')}.md`)))

  const releaseError = gate('/error')
  await open('/error')
  await input.press('Enter')
  releaseError()
  await page.locator('.clip-error').waitFor({ state: 'visible' })
  await waitUntil('queue clears on failure', async () =>
    (await status.innerText()).includes('Could not fetch'),
  )
  assert(await page.locator('.clip-action-main').isDisabled())
  await input.press('Escape')

  const releaseOld = gate('/old')
  await open('/old')
  await input.press('Tab')
  await folderInput.fill('Research')
  await folderInput.press('Enter')
  await input.press('Enter')
  await input.fill(`${baseUrl}/new`)
  await waitUntil('new URL ready', async () =>
    (await page.locator('.clip-rd-title').innerText()).includes(title('/new')),
  )
  releaseOld()
  assert.equal(await page.locator('.clip-folder-trigger').innerText(), 'Research')
  await input.press('Tab')
  await folderInput.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
  assert.equal(await page.locator('.clip-dest-pop').count(), 1)
  for (let i = 0; i < 12; i++) await folderInput.press('ArrowDown')
  assert(await page.locator('.clip-dest-list').evaluate((node) => node.scrollTop > 0))
  await folderInput.press('Escape')
  assert(await input.evaluate((node) => node === document.activeElement))
  assert((await page.locator('.clip-rd-title').innerText()).includes(title('/new')))
  assert.equal(await page.locator('.clip-folder-trigger').innerText(), 'Research')
  assert(!fs.existsSync(path.join(workspace, 'Research', `${title('/old')}.md`)))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 650))
  await input.press('Tab')
  const pop = await page.locator('.clip-dest-pop').boundingBox()
  const pane = await page.locator('.clip-ctrl').boundingBox()
  assert(pop.x + pop.width <= pane.x + pane.width)
  await screenshot('narrow-folder')
  await folderInput.fill('Very long destination directory name')
  await folderInput.press('Enter')
  const widthAt100 = await page.evaluate(() => window.innerWidth)
  for (const zoom of [1, 1.25, 1.5]) {
    await app.evaluate(({ BrowserWindow }, factor) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor)
    }, zoom)
    await waitUntil('zoom applied', () =>
      page.evaluate((width) => Math.abs(window.innerWidth - width) <= 1, widthAt100 / zoom),
    )
    await waitUntil('folder controls fit at zoom ' + zoom, () =>
      page.locator('.clip-save .clip-action-row').evaluate((row) => {
        const bounds = row.getBoundingClientRect()
        return [...row.children].every((child) => {
          const box = child.getBoundingClientRect()
          return box.left >= bounds.left && box.right <= bounds.right
        })
      }),
    )
    assert(
      await page
        .locator('.clip-folder-trigger span')
        .evaluate((node) => node.scrollWidth > node.clientWidth),
    )
    await screenshot(`long-folder-${zoom}`)
  }
  await page.evaluate(() => window.api.invoke('invoke-set-settings', { patch: { theme: 'dark' } }))
  await waitUntil('dark theme', () =>
    page.evaluate(() => document.documentElement.dataset.theme === 'dark'),
  )
  await screenshot('dark')
  assert(!logs.some((line) => line.includes('[pageerror]')), logs.join('\n'))
  console.log(
    JSON.stringify({
      ok: true,
      screenshots: screenshotDir,
      scenarios: [
        'ready',
        'folder keyboard',
        'save',
        'queued save and open',
        'duplicates',
        'queued duplicate',
        'failure',
        'URL change',
        'destination survives URL edits; queued old capture is cancelled',
        'IME',
        'narrow',
        'long folder at 100–150% zoom',
        'dark',
      ],
    }),
  )
}
try {
  await run()
} catch (error) {
  console.error(error)
  console.error(logs.join('\n'))
  await app
    ?.windows()[0]
    ?.screenshot({ path: path.join(testRoot, 'failure.png') })
    .catch(() => {})
  process.exitCode = 1
} finally {
  for (const entry of gates.values()) entry.release()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  if (app) {
    const child = app.process()
    const exited =
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once('exit', resolve))
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {})
    await exited
  }
  if (process.exitCode) console.error(`Preserved E2E files: ${testRoot}`)
  else fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
