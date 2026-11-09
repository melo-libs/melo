import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'melo-links-e2e-')))
const workspace = path.join(root, 'workspace')
const profile = path.join(root, 'profile')
let app
let page
const errors = []
try {
  fs.mkdirSync(workspace)
  fs.mkdirSync(profile)
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ lastDirectory: workspace }),
  )
  fs.writeFileSync(
    path.join(workspace, 'links.md'),
    '[Example **website**](https://example.com/)\n\nPlain text.\n',
  )
  app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot],
    cwd: projectRoot,
    env: { ...process.env, MELO_USER_DATA: profile, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  await app.evaluate(({ shell }) => {
    // Exercise real new-window routing without launching a browser or mail app.
    globalThis.openedEditorLinks = []
    shell.openExternal = async (url) => {
      globalThis.openedEditorLinks.push(url)
    }
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.stack))
  await page
    .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'links' }) })
    .first()
    .click()
  const link = page.locator('.ProseMirror a[href="https://example.com/"]')
  await link.waitFor()
  const body = () => page.locator('.ProseMirror').evaluate((element) => element.editor.getJSON())
  const original = await body()
  const opened = () => app.evaluate(() => globalThis.openedEditorLinks)
  const clearOpened = () =>
    app.evaluate(() => {
      globalThis.openedEditorLinks = []
    })
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

  const linkCursor = () =>
    link.locator('strong').evaluate((element) => getComputedStyle(element).cursor)
  await link.hover()
  assert.equal(await linkCursor(), 'text')
  await page.keyboard.down(modifier)
  assert.equal(
    await linkCursor(),
    'pointer',
    'pressing the modifier without moving must update the cursor',
  )
  await page.keyboard.down('Shift')
  assert.equal(await linkCursor(), 'text')
  await page.keyboard.up('Shift')
  assert.equal(await linkCursor(), 'pointer')
  await page.keyboard.up(modifier)
  assert.equal(await linkCursor(), 'text')
  await page.keyboard.down(modifier)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  assert.equal(await linkCursor(), 'text', 'window blur must clear the navigation cursor')
  await page.keyboard.up(modifier)

  await link.locator('strong').click()
  const openButton = page.locator('.bubble-selection > button[aria-label="Open link"]')
  await openButton.waitFor()
  await page.locator('.bubble-selection').evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
  })
  await page.screenshot({ path: '/tmp/melo-link-actions.png' })
  assert.deepEqual(await opened(), [], 'ordinary editable clicks must not open the browser')
  await openButton.click()
  await assertEventually(() => opened(), ['https://example.com/'])
  assert.deepEqual(await body(), original, 'opening must not modify the document')

  await clearOpened()
  await link.locator('strong').click({ modifiers: [modifier] })
  await assertEventually(() => opened(), ['https://example.com/'])
  assert.deepEqual(await body(), original)

  await clearOpened()
  await link.locator('strong').click()
  await page.locator('.bubble-selection').getByTitle('Add link ⌘K', { exact: true }).click()
  await page.locator('.link-pop input[type="url"]').waitFor()
  assert.equal(
    await page.locator('.link-pop input[type="url"]').inputValue(),
    'https://example.com/',
  )
  await page.locator('.link-pop').evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
  })
  await page.screenshot({ path: '/tmp/melo-link-editor.png' })
  await page.locator('.link-pop input[type="url"]').fill('https://example.org/updated')
  await page.locator('.link-pop .lk-apply').click()
  const updated = page.locator('.ProseMirror a[href="https://example.org/updated"]')
  await updated.waitFor()
  assert.deepEqual(await opened(), [], 'editing must not trigger navigation')

  await page.locator('.ProseMirror').evaluate((element) => element.editor.setEditable(false))
  await updated.hover()
  assert.equal(await updated.evaluate((element) => getComputedStyle(element).cursor), 'pointer')
  await updated.click()
  await assertEventually(() => opened(), ['https://example.org/updated'])
  await page.locator('.ProseMirror').evaluate((element) => element.editor.setEditable(true))

  await clearOpened()
  await page.locator('.ProseMirror p').last().click()
  await page.waitForFunction(() => !document.querySelector('.bubble-selection'))
  assert.deepEqual(await opened(), [])
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify(
      {
        ok: true,
        coverage: [
          'ordinary editing',
          'visible open action',
          'modifier-click',
          'modifier cursor, key release and window blur',
          'nested marks',
          'unchanged document',
          'link editing',
          'read-only navigation',
          'plain-text dismissal',
          'system handler routing',
        ],
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(error)
  if (page) await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {})
  console.error(`Preserved diagnostics: ${root}`)
  process.exitCode = 1
} finally {
  if (app) {
    const child = app.process()
    const exited =
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once('exit', resolve))
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await exited
  }
  if (!process.exitCode)
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

async function assertEventually(read, expected) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const actual = await read()
    if (JSON.stringify(actual) === JSON.stringify(expected)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.deepEqual(await read(), expected)
}
