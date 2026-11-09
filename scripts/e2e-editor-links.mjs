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
  fs.mkdirSync(path.join(workspace, 'notes', 'deep'), { recursive: true })
  fs.mkdirSync(path.join(workspace, '.assets'))
  fs.writeFileSync(path.join(workspace, 'notes', 'deep', 'inside.md'), '# Inside\n')
  fs.writeFileSync(
    path.join(workspace, 'notes', 'next.md'),
    '# Next\n\n' + 'Paragraph.\n\n'.repeat(35) + '## Target heading\n\nTarget body.\n',
  )
  fs.writeFileSync(
    path.join(workspace, '.assets', 'image.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  )
  fs.writeFileSync(path.join(workspace, 'preview.pdf'), blankPdf())
  fs.writeFileSync(path.join(workspace, 'deck.key'), 'Unsupported viewer fixture')
  fs.writeFileSync(path.join(root, 'outside.md'), '# Outside\n')
  fs.symlinkSync(path.join(root, 'outside.md'), path.join(workspace, 'escape.md'))
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ lastDirectory: workspace }),
  )
  fs.writeFileSync(
    path.join(workspace, 'links.md'),
    '[Example **website**](https://example.com/)\n\n' +
      '[Relative note](notes/next.md#target-heading)\n\n' +
      '[Image](.assets/image.png)\n\n[PDF](preview.pdf)\n\n' +
      '[Folder](notes/deep)\n\n[Missing](missing.md)\n\n' +
      '[Outside symlink](escape.md)\n\n[System file](deck.key)\n\n' +
      '[Current heading](#current-heading)\n\n' +
      'Paragraph.\n\n'.repeat(20) +
      '## Current heading\n\nPlain text.\n',
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
    globalThis.openedEditorPaths = []
    shell.openExternal = async (url) => {
      globalThis.openedEditorLinks.push(url)
    }
    shell.openPath = async (target) => {
      globalThis.openedEditorPaths.push(target)
      return ''
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

  const sourceRow = page.locator('.tree-row', {
    has: page.locator('.tree-name', { hasText: /^links$/ }),
  })
  const goBack = async () => {
    await sourceRow.click()
    await page.locator('.ProseMirror a[href="notes/next.md#target-heading"]').waitFor()
    await page.locator('.ProseMirror').evaluate((element) => {
      element.editor.commands.focus('start')
    })
  }
  const follow = async (href) => {
    await page.locator(`.ProseMirror a[href="${href}"]`).click({ modifiers: [modifier] })
  }

  await follow('#current-heading')
  await page.waitForFunction(() => document.querySelector('.ed-scroll').scrollTop > 100)
  await follow('notes/next.md#target-heading')
  await page
    .locator('.ProseMirror h1')
    .filter({ hasText: /^Next$/ })
    .waitFor()
  await page.waitForFunction(() => document.querySelector('.ed-scroll').scrollTop > 300)
  assert.equal(
    await page.locator('.ed-tab[data-active="true"] .ed-tab-title').textContent(),
    'next',
  )

  await goBack()
  await page.locator('.ProseMirror a[href="notes/next.md#target-heading"]').click()
  await page.locator('.bubble-selection').getByTitle('Add link ⌘K', { exact: true }).click()
  await page.locator('.link-pop .lk-apply').click()
  assert.equal(
    await page.locator('.ProseMirror a[href="notes/next.md#target-heading"]').count(),
    1,
    'saving an existing relative link must preserve its href',
  )

  await follow('.assets/image.png')
  await page.locator('.viewer-media img').waitFor()
  await page.waitForFunction(() => document.querySelector('.viewer-media img')?.naturalWidth === 1)
  assert.equal(
    await page.locator('.ed-tab[data-active="true"] .ed-tab-title').textContent(),
    'image.png',
  )
  await goBack()
  await follow('preview.pdf')
  await page.locator('.pdf-page canvas').waitFor()
  assert.equal(
    await page.locator('.ed-tab[data-active="true"] .ed-tab-title').textContent(),
    'preview.pdf',
  )
  await goBack()
  await follow('notes/deep')
  await page
    .locator('.tree-row', { has: page.locator('.tree-name', { hasText: /^inside$/ }) })
    .waitFor()
  assert.equal(
    await page.locator('.ed-tab[data-active="true"] .ed-tab-title').textContent(),
    'links',
  )
  await follow('missing.md')
  await page.getByText('The linked file or folder could not be found.', { exact: true }).waitFor()
  await follow('escape.md')
  await page.getByText('This link points outside the current workspace.', { exact: true }).waitFor()
  await follow('deck.key')
  await assertEventually(
    () => app.evaluate(() => globalThis.openedEditorPaths),
    [path.join(workspace, 'deck.key')],
  )
  assert.deepEqual(await opened(), [], 'local paths must never reach the browser handler')
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
          'relative note and cross-note fragment',
          'fragment-only navigation',
          'preserved local href on edit',
          'in-app image and PDF viewers',
          'directory reveal',
          'missing and outside-workspace feedback',
          'unsupported file uses safe system opening',
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

function blankPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 4\n0000000000 65535 f \n${offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}`
  return pdf + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
}
