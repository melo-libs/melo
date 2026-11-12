import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Workspace registration uses realpath; /var is a symlink on macOS.
const testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'melo-watcher-e2e-')))
const workspace = path.join(testRoot, 'workspace')
const profile = path.join(testRoot, 'profile')
const LARGE_FOLDER_COUNT = Number(process.env.MELO_E2E_FOLDER_COUNT ?? 2500)
const screenshotPath = process.env.MELO_E2E_SCREENSHOT
const browseScreenshotPath = process.env.MELO_E2E_BROWSE_SCREENSHOT
const clipScreenshotPath = process.env.MELO_E2E_CLIP_SCREENSHOT
const smartScreenshotPath = process.env.MELO_E2E_SMART_SCREENSHOT
const outlineScreenshotPath = process.env.MELO_E2E_OUTLINE_SCREENSHOT
const tableScreenshotPath = process.env.MELO_E2E_TABLE_SCREENSHOT
const smartBuilderScreenshotPath = process.env.MELO_E2E_SMART_BUILDER_SCREENSHOT
const logs = []
let app
let socketServer

const note = (title, body, source) =>
  `${source ? `---\nsource: ${source}\ncreated: 2026-08-09T00:00:00Z\n---\n\n` : ''}# ${title}\n\n${body}\n`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitUntil(label, check, timeout = 20000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      lastError = error
    }
    await sleep(100)
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`)
}

const treeRow = (page, baseName) =>
  page.locator('.tree-row', {
    has: page.locator('.tree-name', { hasText: baseName }),
  })

function seedWorkspace() {
  fs.mkdirSync(workspace, { recursive: true })
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ lastDirectory: workspace }, null, 2),
  )
  fs.writeFileSync(
    path.join(workspace, 'captured.md'),
    note('Captured', 'A note with source metadata.', 'https://www.example.com/article').replace(
      '---\n\n',
      'favicon: ".assets/favicons/example #1.svg"\n---\n\n',
    ),
  )
  fs.mkdirSync(path.join(workspace, '.assets', 'favicons'), { recursive: true })
  fs.writeFileSync(
    path.join(workspace, '.assets', 'favicons', 'example #1.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="#356ef6"/></svg>',
  )
  fs.writeFileSync(path.join(workspace, 'delete-me.md'), note('Delete Me', 'Remove externally.'))
  fs.writeFileSync(
    path.join(workspace, 'table-alignment.md'),
    note(
      'Table alignment',
      '| Item | Status |\n| :--- | ---: |\n| First | One |\n| Second | Two |',
    ),
  )
  fs.writeFileSync(
    path.join(workspace, 'outline-sample.md'),
    note(
      'Outline sample',
      Array.from(
        { length: 12 },
        (_, index) =>
          `## Section ${index + 1}\n\n${'A paragraph about reading and writing. '.repeat(16)}\n\n### Detail ${index + 1}\n\n${'More details. '.repeat(24)}`,
      ).join('\n\n'),
    ),
  )
  fs.writeFileSync(
    path.join(workspace, 'ref-a.md'),
    note('Reference A', '[[outline-sample]]\n\nAnother [[outline-sample]]'),
  )
  fs.writeFileSync(path.join(workspace, 'ref-b.md'), note('Reference B', '[[outline-sample]]'))
  for (let index = 0; index < 33; index++) {
    fs.writeFileSync(
      path.join(workspace, `ref-extra-${index}.md`),
      note(`Reference ${index}`, '[[outline-sample]]'),
    )
  }
  fs.writeFileSync(path.join(workspace, 'no-headings.md'), 'Plain text without a heading.\n')
  fs.writeFileSync(
    path.join(workspace, 'many-headings.md'),
    note(
      'Many headings',
      Array.from(
        { length: 80 },
        (_, index) => `## Chapter ${index + 1}\n\n${'Reading text. '.repeat(40)}`,
      ).join('\n\n'),
    ),
  )
  fs.writeFileSync(
    path.join(workspace, 'outline-image.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmS8AAAAASUVORK5CYII=',
      'base64',
    ),
  )
  fs.mkdirSync(path.join(workspace, '00 Parent', '00 Child', '00 Target', '00 Deep'), {
    recursive: true,
  })

  for (let index = 0; index < LARGE_FOLDER_COUNT; index += 1) {
    const folder = path.join(workspace, `Folder-${String(index).padStart(4, '0')}`)
    fs.mkdirSync(folder)
    fs.writeFileSync(path.join(folder, 'note.md'), note(`Note ${index}`, `Body ${index}`))
    fs.writeFileSync(path.join(folder, 'one.txt'), `one ${index}`)
    fs.writeFileSync(path.join(folder, 'two.txt'), `two ${index}`)
  }
}

async function run() {
  seedWorkspace()
  // Mirrors folders such as svc/mysql/mysql.sock. It must be ignored as a
  // special entry rather than watched, indexed, or surfaced as a document.
  const socketPath = path.join(workspace, 'mysql.sock')
  socketServer = net.createServer()
  await new Promise((resolve, reject) => {
    socketServer.once('error', reject)
    socketServer.listen(socketPath, resolve)
  })
  const startedAt = Date.now()
  app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      MELO_USER_DATA: profile,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    timeout: 30000,
  })

  app.process().stdout?.on('data', (chunk) => logs.push(String(chunk)))
  app.process().stderr?.on('data', (chunk) => logs.push(String(chunk)))

  const page = await app.firstWindow({ timeout: 30000 })
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      logs.push(`[renderer:${message.type()}] ${message.text()}\n`)
    }
  })
  page.on('pageerror', (error) => logs.push(`[renderer:pageerror] ${error.stack ?? error}\n`))

  await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 30000 })
  if (process.platform === 'darwin') {
    const nativeLabels = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()
        .items[0].submenu.items.filter((item) => ['about', 'hide', 'quit'].includes(item.role))
        .map((item) => item.label),
    )
    assert.deepEqual(nativeLabels, ['About Melo', 'Hide Melo', 'Quit Melo'])
  }
  assert.equal(
    await page.locator('.ws-opener').count(),
    0,
    'workspace should restore without a dialog',
  )
  await page.locator('.sf-row').first().waitFor({ state: 'visible', timeout: 30000 })
  assert.deepEqual(
    await page.locator('.sf-row-label').allTextContents(),
    ['Recent', 'Web Clips', 'PDFs'],
    'default smart folders should load on a cold start',
  )
  await page.locator('.sf-row').first().click()
  const smartResults = page.locator('.sf-results')
  await smartResults.waitFor({ state: 'visible', timeout: 30000 })
  await page.locator('.res-row').first().waitFor({ state: 'visible', timeout: 30000 })

  await page.locator('.sf-row', { hasText: 'Web Clips' }).click()
  const smartNote = page.locator(`.res-row[data-path="${path.join(workspace, 'captured.md')}"]`)
  await smartNote.click({ button: 'right' })
  const smartMenu = page.locator('.ctx-menu')
  await smartMenu.waitFor({ state: 'visible' })
  assert.equal(await smartMenu.locator('.ctx-head').count(), 0)
  assert.equal(await smartMenu.locator(':scope > :first-child .ctx-lbl').innerText(), 'Rename…')
  await page.keyboard.press('Escape')
  await smartMenu.waitFor({ state: 'hidden' })
  assert(await smartResults.isVisible(), 'closing the file menu must keep the Smart Folder open')
  await smartNote.click()
  const outline = page.locator('.doc-outline')
  const contents = page.locator('.doc-outline-card')
  const contentsShortcut = process.platform === 'darwin' ? 'Meta+Alt+o' : 'Control+Alt+o'
  const editorWidthBeforeContents = (await page.locator('.editor-content').boundingBox()).width
  await outline.locator('.doc-outline-trigger').hover()
  await contents.waitFor({ state: 'visible' })
  assert((await contents.locator('.doc-outline-item').allTextContents()).includes('Captured'))
  assert(await smartResults.isVisible(), 'opening contents keeps the Smart Folder visible')
  assert.equal(
    (await page.locator('.editor-content').boundingBox()).width,
    editorWidthBeforeContents,
  )
  await contents.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  )
  const hoverCardBounds = await contents.boundingBox()
  const hoverAwayBounds = await page.locator('.ed-breadcrumb').boundingBox()
  // Locator actionability waits can exceed the close delay; exercise pointer travel directly.
  await page.mouse.move(hoverAwayBounds.x + hoverAwayBounds.width / 2, hoverAwayBounds.y + 10)
  await page.mouse.move(hoverCardBounds.x + hoverCardBounds.width / 2, hoverCardBounds.y + 10)
  await page.waitForTimeout(180)
  assert(await contents.isVisible(), 'brief pointer travel must not close the card')
  await page.locator('.ed-breadcrumb').hover()
  await contents.waitFor({ state: 'detached' })
  await page.locator('.ProseMirror').focus()
  await page.keyboard.press(contentsShortcut)
  await contents.waitFor({ state: 'visible' })
  assert(
    await page
      .locator('.doc-outline-item[aria-current]')
      .evaluate((el) => document.activeElement === el),
  )
  await page.keyboard.press('Escape')
  await contents.waitFor({ state: 'detached' })
  assert(
    await page.locator('.ProseMirror').evaluate((el) => document.activeElement === el),
    'Escape restores editor focus after the exit animation',
  )
  await outline.locator('.doc-outline-trigger').focus()
  await page.keyboard.press('Enter')
  await contents.waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  await contents.waitFor({ state: 'detached' })
  assert(
    await outline.locator('.doc-outline-trigger').evaluate((el) => document.activeElement === el),
  )

  await treeRow(page, 'delete-me').first().click()
  await page.locator('.smart-view').waitFor({ state: 'detached' })
  await outline.locator('.doc-outline-trigger').hover()
  await waitUntil('contents follows the active document', async () =>
    (await contents.locator('.doc-outline-item').allTextContents()).includes('Delete Me'),
  )
  await page.locator('.ed-breadcrumb').hover()
  await contents.waitFor({ state: 'detached' })
  const prose = page.locator('.ProseMirror')
  const originalBlocks = await prose.locator(':scope > *').count()
  const beforeBlankClick = await prose.innerText()
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await prose.locator(':scope > p').last().click()
  await page.keyboard.press(modifier === 'Meta' ? 'Meta+ArrowRight' : 'End')
  await page.keyboard.press('Enter')
  await waitUntil(
    'Enter should split a paragraph and place the caret in the new paragraph',
    async () =>
      (await prose.locator(':scope > *').count()) === originalBlocks + 1 &&
      (await prose.locator(':scope > p:last-child').textContent()) === '',
  )
  await page.keyboard.press(`${modifier}+Z`)
  await waitUntil(
    'paragraph splitting should undo',
    async () =>
      (await prose.locator(':scope > *').count()) === originalBlocks &&
      (await prose.innerText()) === beforeBlankClick,
  )
  for (const target of ['ed-page', 'ed-scroll', 'ed-page']) {
    const point = await page.evaluate((target) => {
      const editor = document.querySelector('.ProseMirror').getBoundingClientRect()
      const surface = document.querySelector('.ed-scroll').getBoundingClientRect()
      return {
        x: editor.left + 80,
        y: target === 'ed-page' ? editor.bottom + 40 : surface.bottom - 24,
      }
    }, target)
    assert(
      await page.evaluate(
        ({ x, y, target }) => document.elementFromPoint(x, y)?.classList.contains(target),
        { ...point, target },
      ),
      `fixture should expose blank space in ${target}`,
    )
    await prose.locator('h1').click()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press(`${modifier}+B`)
    await page.mouse.click(point.x, point.y)
    await waitUntil('blank-space click should focus an empty final paragraph', () =>
      page.evaluate(() => {
        const editor = document.querySelector('.ProseMirror')
        const last = editor.lastElementChild
        const selection = window.getSelection()
        return (
          document.activeElement === editor &&
          last.tagName === 'P' &&
          last.textContent === '' &&
          selection?.isCollapsed &&
          last.contains(selection.anchorNode)
        )
      }),
    )
    assert.equal(
      await prose.locator(':scope > *').count(),
      originalBlocks + 1,
      'repeated blank-space clicks must reuse the empty final paragraph',
    )
  }
  await page.keyboard.type('Blank-click continuation.')
  assert.equal(
    await prose.locator(':scope > p:last-child').innerHTML(),
    'Blank-click continuation.',
    'the new paragraph must not inherit bold or heading formatting',
  )
  await waitUntil('typing after a blank-space click should persist as a new paragraph', () =>
    fs
      .readFileSync(path.join(workspace, 'delete-me.md'), 'utf8')
      .trimEnd()
      .endsWith('Remove externally.\n\nBlank-click continuation.'),
  )
  await page.keyboard.press(`${modifier}+Z`)
  await waitUntil(
    'typing should undo normally',
    async () => !(await prose.innerText()).includes('Blank-click continuation.'),
  )
  // Typing may share the insertion's history group if it begins immediately.
  const separateInsertion = (await prose.locator(':scope > *').count()) > originalBlocks
  if (separateInsertion) {
    await page.keyboard.press(`${modifier}+Z`)
  }
  await waitUntil(
    'the empty paragraph insertion should also undo',
    async () =>
      (await prose.locator(':scope > *').count()) === originalBlocks &&
      (await prose.innerText()) === beforeBlankClick,
  )
  await page.keyboard.press(`${modifier}+Shift+Z`)
  if (separateInsertion) await page.keyboard.press(`${modifier}+Shift+Z`)
  await waitUntil(
    'redo should restore the new paragraph',
    async () =>
      (await prose.locator(':scope > p:last-child').innerHTML()) === 'Blank-click continuation.',
  )
  await treeRow(page, 'captured').first().click()
  await waitUntil('switch away from the edited document', async () =>
    (await prose.innerText()).includes('A note with source metadata.'),
  )
  await treeRow(page, 'delete-me').first().click()
  await waitUntil(
    'reopening should preserve the new paragraph without extra blanks',
    async () =>
      (await prose.locator(':scope > *').count()) === originalBlocks + 1 &&
      (await prose.locator(':scope > p:last-child').innerHTML()) === 'Blank-click continuation.',
  )

  const tableFile = path.join(workspace, 'table-alignment.md')
  const tableAlignments = () =>
    prose
      .locator('tr')
      .evaluateAll((rows) =>
        rows.map((row) =>
          Array.from(row.querySelectorAll('th p, td p'), (p) => getComputedStyle(p).textAlign),
        ),
      )
  const expectedAlignments = (alignment) => Array.from({ length: 3 }, () => [alignment, 'right'])
  for (const alignment of ['center', 'right', 'left']) {
    await treeRow(page, 'table-alignment').first().click()
    const row = alignment === 'right' ? 0 : 1
    await prose.locator('tr').nth(row).locator('th, td').first().click()
    await page.getByRole('button', { name: 'Cell options', exact: true }).click()
    await page.getByRole('menuitem', { name: `Align ${alignment}`, exact: true }).click()
    await waitUntil(
      `the whole column should align ${alignment}`,
      async () =>
        JSON.stringify(await tableAlignments()) === JSON.stringify(expectedAlignments(alignment)),
    )
    if (alignment === 'center') {
      await prose.locator('td').first().click()
      await page.keyboard.press(`${modifier}+Z`)
      assert.deepEqual(await tableAlignments(), expectedAlignments('left'))
      await page.keyboard.press(`${modifier}+Shift+Z`)
      assert.deepEqual(await tableAlignments(), expectedAlignments('center'))
      if (tableScreenshotPath) await page.screenshot({ path: tableScreenshotPath })
    }
    await page.keyboard.press(`${modifier}+S`)
    await waitUntil('alignment should persist in the Markdown delimiter row', () => {
      const separator = fs
        .readFileSync(tableFile, 'utf8')
        .split('\n')
        .find((line) => /^\|\s*:?-{3,}:?\s*\|/u.test(line))
      return alignment === 'center'
        ? /^\|\s*:-+:\s*\|/u.test(separator ?? '')
        : alignment === 'right'
          ? /^\|\s*-+:\s*\|/u.test(separator ?? '')
          : /^\|\s*:-+\s*\|/u.test(separator ?? '')
    })
    await treeRow(page, 'captured').first().click()
    await prose.locator('h1', { hasText: 'Captured' }).waitFor()
    await treeRow(page, 'table-alignment').first().click()
    await waitUntil(
      'alignment should survive reopening the document',
      async () =>
        JSON.stringify(await tableAlignments()) === JSON.stringify(expectedAlignments(alignment)),
    )
  }
  await treeRow(page, 'captured').first().click()
  await page.locator('.sf-row', { hasText: 'Web Clips' }).click()
  await smartResults.waitFor({ state: 'visible' })
  await outline.locator('.doc-outline-trigger').hover()
  await waitUntil('contents follows the Smart Folder result', async () =>
    (await contents.locator('.doc-outline-item').allTextContents()).includes('Captured'),
  )
  await page.locator('.ed-breadcrumb').hover()

  const originalWindowSize = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getSize(),
  )
  const originalListWidth = (await page.locator('.smart-view').boundingBox()).width
  const preferredWidths = await page.evaluate(() => ({
    sidebar: localStorage.getItem('melo.sidebarWidth'),
    smartList: localStorage.getItem('melo.smartListWidth'),
  }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 860))
  assert((await page.locator('.editor-content').boundingBox()).width >= 320)
  assert((await page.locator('.smart-view').boundingBox()).width >= 240)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await outline.locator('.doc-outline-trigger').hover()
  await contents.waitFor({ state: 'visible' })
  const cardBounds = await contents.boundingBox()
  const readingBounds = await page.locator('.ed-reading').boundingBox()
  assert(
    cardBounds.x >= readingBounds.x &&
      cardBounds.x + cardBounds.width <= readingBounds.x + readingBounds.width,
  )
  await page.locator('.ed-breadcrumb').hover()

  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25),
  )
  await waitUntil(
    'zoomed Smart Folder collapses the sidebar',
    async () => (await page.locator('.app').getAttribute('data-sidebar')) === 'hidden',
  )
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.getByRole('button', { name: 'Toggle files', exact: true }).click()
  await page.locator('.smart-view').waitFor({ state: 'detached' })
  await page.locator('.sidebar').waitFor({ state: 'visible' })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1),
  )
  await page.locator('.sf-row', { hasText: 'Web Clips' }).click()
  await smartResults.waitFor({ state: 'visible' })
  await app.evaluate(
    ({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height),
    originalWindowSize,
  )
  await waitUntil(
    'widening restores the sidebar',
    async () => (await page.locator('.app').getAttribute('data-sidebar')) === 'shown',
  )
  assert.equal((await page.locator('.smart-view').boundingBox()).width, originalListWidth)
  assert.deepEqual(
    await page.evaluate(() => ({
      sidebar: localStorage.getItem('melo.sidebarWidth'),
      smartList: localStorage.getItem('melo.smartListWidth'),
    })),
    preferredWidths,
  )
  await outline.locator('.doc-outline-trigger').hover()
  if (outlineScreenshotPath) await page.screenshot({ path: outlineScreenshotPath, fullPage: true })
  await page.locator('.ed-breadcrumb').hover()

  await treeRow(page, 'outline-sample').first().click()
  await page.locator('.ProseMirror h1', { hasText: 'Outline sample' }).waitFor()
  await outline.locator('.doc-outline-trigger span').first().waitFor()
  assert.equal(await outline.getAttribute('data-dense'), 'true')
  assert.equal(await outline.locator('.doc-outline-trigger span').count(), 13)
  await outline.locator('.doc-outline-trigger').hover()
  await contents.waitFor({ state: 'visible' })
  assert.equal(await contents.locator('.doc-outline-item').count(), 25)
  assert.equal(
    await page.locator('.document-tags-add').count(),
    1,
    'references and tags must have distinct sibling keys',
  )
  assert.equal(await contents.locator('.doc-outline-list').getAttribute('data-below'), 'true')
  await page.locator('.ed-breadcrumb').hover()
  await contents.waitFor({ state: 'detached' })
  const proseForOutline = page.locator('.ProseMirror')
  await proseForOutline
    .locator('h2', { hasText: 'Section 8', exact: true })
    .evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.keyboard.press(contentsShortcut)
  await waitUntil(
    'current heading is revealed even when its scroll update arrives after opening',
    async () =>
      (await page.locator('.doc-outline-item[aria-current]').innerText()) === 'Section 8' &&
      (await contents.locator('.doc-outline-list').evaluate((el) => el.scrollTop > 0)),
  )
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Detail 8')
  await page.keyboard.press('Escape')
  await contents.waitFor({ state: 'detached' })
  await outline.locator('.doc-outline-trigger').hover()
  await contents.waitFor({ state: 'visible' })
  assert.equal(
    await contents.locator('.doc-outline-item[tabindex="0"]').innerText(),
    'Section 8',
    'hover reopening starts from the current heading rather than the previous keyboard cursor',
  )
  await page.locator('.ed-breadcrumb').hover()
  await contents.waitFor({ state: 'detached' })
  await page.keyboard.press(contentsShortcut)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await contents.waitFor({ state: 'detached' })
  await waitUntil('keyboard jump scrolls to a heading', async () => {
    const heading = await proseForOutline
      .locator('h3', { hasText: 'Detail 8', exact: true })
      .boundingBox()
    const scroll = await page.locator('.ed-scroll').boundingBox()
    return Math.abs(heading.y - scroll.y) < 30
  })
  const referenceButton = page.locator('.ed-bar-references')
  await waitUntil(
    'footer counts referring notes rather than occurrences',
    async () => (await referenceButton.innerText()) === '35 references',
  )
  await referenceButton.click()
  await page.locator('.bl-body').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.bl-group').count(), 35)
  assert.equal(await page.locator('.bl-count').first().innerText(), '35')
  await waitUntil('footer reveals references at the end of the note', async () => {
    const section = await page.locator('.bl').boundingBox()
    const reading = await page.locator('.ed-scroll').boundingBox()
    return section.y >= reading.y && section.y < reading.y + reading.height
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700))
  await waitUntil(
    'narrow footer hides secondary metadata',
    async () => !(await page.locator('.ed-bar-detail').last().isVisible()),
  )
  assert(await referenceButton.isVisible())
  const referenceBounds = await referenceButton.boundingBox()
  const footerBounds = await page.locator('.ed-bottombar').boundingBox()
  assert(
    referenceBounds.x >= footerBounds.x &&
      referenceBounds.x + referenceBounds.width <= footerBounds.x + footerBounds.width,
  )
  assert(await page.locator('.ed-bottombar').evaluate((el) => el.scrollWidth <= el.clientWidth))
  if (outlineScreenshotPath)
    await page.screenshot({ path: outlineScreenshotPath.replace('.png', '-references.png') })
  await app.evaluate(
    ({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height),
    originalWindowSize,
  )
  await treeRow(page, 'no-headings').first().click()
  await page.locator('.ProseMirror', { hasText: 'Plain text without a heading.' }).waitFor()
  await outline.waitFor({ state: 'detached' })
  assert.equal(await referenceButton.count(), 0)
  await treeRow(page, 'many-headings').first().click()
  await page.locator('.ProseMirror h1', { hasText: 'Many headings' }).waitFor()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 520))
  await waitUntil('all dense marks fit inside the shorter window', async () => {
    const marks = outline.locator('.doc-outline-trigger span')
    if ((await marks.count()) !== 81) return false
    const first = await marks.first().boundingBox()
    const last = await marks.last().boundingBox()
    const trigger = await outline.locator('.doc-outline-trigger').boundingBox()
    const reading = await page.locator('.ed-reading').boundingBox()
    return (
      first.y >= trigger.y &&
      last.y + last.height <= trigger.y + trigger.height &&
      trigger.y >= reading.y &&
      trigger.y + trigger.height <= reading.y + reading.height
    )
  })
  await page
    .locator('.ProseMirror h2', { hasText: 'Chapter 80', exact: true })
    .evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await outline.locator('.doc-outline-trigger').hover()
  await contents.waitFor({ state: 'visible' })
  assert.equal(await contents.locator('.doc-outline-item').count(), 81)
  await waitUntil('card opening animation settles', () =>
    contents.evaluate(
      (el) => getComputedStyle(el).opacity === '1' && getComputedStyle(el).transform === 'none',
    ),
  )
  if (outlineScreenshotPath) {
    await page.screenshot({ path: outlineScreenshotPath.replace('.png', '-dense.png') })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await contents.evaluate((element) =>
      Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    )
    await page.screenshot({ path: outlineScreenshotPath.replace('.png', '-dense-dark.png') })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  }
  await page.locator('.ed-breadcrumb').hover()
  await contents.waitFor({ state: 'detached' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.locator('.ProseMirror').focus()
  await page.keyboard.press(contentsShortcut)
  await contents.waitFor({ state: 'visible' })
  assert.equal(
    await outline
      .locator('.doc-outline-trigger span')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    '0s',
  )
  await page.keyboard.press('Escape')
  await contents.waitFor({ state: 'detached' })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await app.evaluate(
    ({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height),
    originalWindowSize,
  )
  await treeRow(page, 'outline-image').first().click()
  await page.locator('.ed-scroll[data-viewer]').waitFor()
  assert.equal(await outline.count(), 0)

  await page.locator('.sf-row', { hasText: 'Recent' }).click()
  await smartResults.waitFor({ state: 'visible' })
  await page.locator('.res-row').first().waitFor({ state: 'visible' })

  const sortButton = page.locator('.sf-sort')
  await sortButton.click()
  await page.locator('.pop-opt', { hasText: 'Oldest first' }).click()
  await waitUntil('smart-folder sort should persist', () => {
    const views = JSON.parse(fs.readFileSync(path.join(workspace, '.melo', 'views.json'), 'utf8'))
    return views.find((view) => view.id === 'recent')?.sort === 'Oldest first'
  })
  await page.locator('.sf-row', { hasText: 'Web Clips' }).click()
  await page.locator('.sf-row', { hasText: 'Recent' }).click()
  await waitUntil('smart-folder sort should survive switching views', async () =>
    (await sortButton.innerText()).includes('Oldest first'),
  )
  await sortButton.click()
  await page.locator('.pop-opt', { hasText: 'Newest first' }).click()
  await waitUntil('restored sort should persist', () => {
    const views = JSON.parse(fs.readFileSync(path.join(workspace, '.melo', 'views.json'), 'utf8'))
    return views.find((view) => view.id === 'recent')?.sort === 'Newest first'
  })

  await page.locator('.sv-iconbtn').click()
  const addRule = page.locator('.smart-modal .rule-add')
  for (let ruleNumber = 1; ruleNumber <= 20; ruleNumber += 1) {
    await addRule.scrollIntoViewIfNeeded()
    await addRule.click()
    await page.locator('.smart-modal .pop-opt', { hasText: /^Kind$/ }).click()
  }
  assert(await addRule.isDisabled(), 'the builder should stop at the shared 20-rule limit')
  assert.match(
    (await addRule.getAttribute('title')) ?? '',
    /20/,
    'the disabled rule control should explain its limit',
  )
  if (smartBuilderScreenshotPath) {
    await page.screenshot({ path: smartBuilderScreenshotPath, fullPage: true })
  }
  await page.locator('.smart-modal .modal-close').click()
  await page.locator('.smart-modal').waitFor({ state: 'detached' })

  let smartHeight = await smartResults.evaluate((element) => element.scrollHeight)
  // Initial 50 + four more pages proves the view continues beyond the old
  // 200-result ceiling without making the DOM grow with every loaded row.
  for (let pageNumber = 2; pageNumber <= 5; pageNumber += 1) {
    const previousHeight = smartHeight
    await smartResults.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll'))
    })
    await waitUntil(`recent page ${pageNumber} should load while scrolling`, async () => {
      smartHeight = await smartResults.evaluate((element) => element.scrollHeight)
      return smartHeight > previousHeight
    })
  }
  assert(
    smartHeight > 10_000,
    `Recent should contain more than 200 loaded rows; scroll height is ${smartHeight}px`,
  )
  const mountedSmartRows = await smartResults.locator('.res-row').count()
  assert(
    mountedSmartRows < 60,
    `recent items should virtualize loaded pages; mounted ${mountedSmartRows} rows`,
  )
  if (smartScreenshotPath) {
    await smartResults.evaluate((element) => {
      element.scrollTop = 0
      element.dispatchEvent(new Event('scroll'))
    })
    await page.screenshot({ path: smartScreenshotPath, fullPage: true })
  }
  assert.equal(await treeRow(page, 'mysql').count(), 0, 'Unix sockets must not appear in the tree')

  // This is the regression that the split index/filesystem event introduced:
  // source metadata must appear after the initial index finishes.
  const capturedRow = treeRow(page, 'captured').first()
  await capturedRow.waitFor({ state: 'attached', timeout: 30000 })
  const clipIcon = capturedRow.locator('.tree-file-icon.ft-clip')
  await clipIcon.waitFor({
    state: 'attached',
    timeout: 30000,
  })
  assert.match(
    (await clipIcon.locator('title').textContent()) ?? '',
    /Web clipping|网页剪藏/,
    'a sourced note should identify itself as a web clipping',
  )
  assert.match(
    (await clipIcon.locator('title').textContent()) ?? '',
    /example\.com/,
    'the clip icon tooltip should name the source host',
  )
  assert.equal(
    await capturedRow.locator('.tree-source-dot').count(),
    0,
    'source initials should not appear as a separate status marker',
  )
  await capturedRow.click()
  const bannerFavicon = page.locator('.ed-clip .favicon img')
  await waitUntil('the captured local favicon should load in the document', () =>
    bannerFavicon.evaluate((image) => image.complete && image.naturalWidth > 0),
  )
  await capturedRow.click({ button: 'right' })
  await page.locator('.ctx-item', { hasText: 'Properties' }).click()
  const propertiesFavicon = page.locator('.prop-card .favicon img')
  await waitUntil(
    'properties should reuse the same local favicon',
    async () =>
      (await propertiesFavicon.getAttribute('src')) === (await bannerFavicon.getAttribute('src')) &&
      (await propertiesFavicon.evaluate((image) => image.complete && image.naturalWidth > 0)),
  )
  if (clipScreenshotPath) {
    await page.screenshot({
      path: clipScreenshotPath.replace(/\.png$/, '-properties.png'),
      fullPage: true,
    })
  }
  await page.locator('.prop-close').click()
  if (clipScreenshotPath) {
    await capturedRow.scrollIntoViewIfNeeded()
    await page.screenshot({ path: clipScreenshotPath, fullPage: true })
  }

  // External create → tree, editor, and full-text index.
  const externalPath = path.join(workspace, 'external-added.md')
  fs.writeFileSync(
    externalPath,
    note('External Added', 'The first external body uses amberwatchertoken.'),
  )
  const externalRow = treeRow(page, 'external-added').first()
  await externalRow.waitFor({ state: 'attached', timeout: 20000 })
  await externalRow.scrollIntoViewIfNeeded()
  await externalRow.click()
  await waitUntil('external file should open in the editor', async () =>
    (await page.locator('.ProseMirror').innerText()).includes('amberwatchertoken'),
  )

  // External update → a clean active document reloads, and the updated body is
  // searchable through the real renderer→IPC→SQLite path.
  fs.writeFileSync(
    externalPath,
    note('External Added', 'The updated external body uses ceruleanwatchertoken.'),
  )
  await waitUntil('external edit should reconcile the active document', async () =>
    (await page.locator('.ProseMirror').innerText()).includes('ceruleanwatchertoken'),
  )
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  await page.locator('.sf-input').fill('ceruleanwatchertoken')
  await page
    .locator('.pb-row-title', { hasText: /external-added/i })
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
  await page.keyboard.press('Escape')

  // External deletion and a populated directory import exercise remove and
  // parent-first subtree compaction.
  fs.unlinkSync(path.join(workspace, 'delete-me.md'))
  await treeRow(page, 'delete-me').first().waitFor({ state: 'detached', timeout: 20000 })

  const imported = path.join(workspace, 'Imported')
  fs.mkdirSync(imported)
  fs.writeFileSync(path.join(imported, 'inside.md'), note('Inside Imported', 'Imported child.'))
  const importedRow = treeRow(page, 'Imported').first()
  await importedRow.waitFor({ state: 'attached', timeout: 20000 })
  await importedRow.scrollIntoViewIfNeeded()
  await importedRow.click()
  await treeRow(page, 'inside').first().waitFor({ state: 'visible', timeout: 10000 })

  // Move To opens one searchable folder picker. Its browse list stays virtual
  // even at the workspace root, search understands full paths, and confirming
  // moves the real active file while keeping its open tab attached.
  await externalRow.scrollIntoViewIfNeeded()
  await externalRow.click({ button: 'right' })
  const fileMenu = page.locator('.ctx-menu')
  await fileMenu.waitFor({ state: 'visible' })
  assert.equal(await fileMenu.locator('.ctx-head').count(), 0)
  assert.equal(await fileMenu.locator(':scope > :first-child .ctx-lbl').innerText(), 'Rename…')
  const moveTrigger = page
    .locator('.ctx-item')
    .filter({ hasText: /Move to|移动到/ })
    .first()
  await moveTrigger.click()
  const moveDialog = page.locator('.move-dialog')
  await moveDialog.waitFor({ state: 'visible', timeout: 10000 })
  assert.equal(await page.locator('.ctx-submenu').count(), 0, 'Move To should not open a submenu')
  const dialogBox = await moveDialog.boundingBox()
  assert(dialogBox, 'Move To dialog should have a layout box')
  assert(dialogBox.width <= 496, `Move To dialog is unexpectedly wide: ${dialogBox.width}px`)
  const moveList = moveDialog.locator('.move-dialog-list')
  const mountedAtTop = await moveList.locator('.move-dialog-row').count()
  assert(
    mountedAtTop > 0 && mountedAtTop < 30,
    `Move picker should virtualize ${LARGE_FOLDER_COUNT} folders; mounted ${mountedAtTop}`,
  )
  const moveButton = moveDialog.locator('.move-dialog-confirm')
  assert(
    await moveButton.isDisabled(),
    'Move here should be disabled for the source current parent',
  )
  assert.equal(
    await moveList.locator('.move-dialog-row.active').count(),
    0,
    'browse mode should not make the first folder look selected',
  )
  if (browseScreenshotPath) {
    await page.screenshot({ path: browseScreenshotPath, fullPage: true })
  }
  await moveList.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll'))
  })
  await waitUntil('virtual move picker should reach its final folder', async () => {
    const text = await moveList.innerText()
    return text.includes(`Folder-${String(LARGE_FOLDER_COUNT - 1).padStart(4, '0')}`)
  })
  assert((await moveList.locator('.move-dialog-row').count()) < 30, 'move list should stay bounded')

  await moveList.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
  const parentFolderRow = moveDialog.locator('.move-dialog-row', { hasText: '00 Parent' })
  await parentFolderRow.waitFor({ state: 'visible' })
  await parentFolderRow.click()
  await moveDialog
    .locator('.move-dialog-row', { hasText: '00 Child' })
    .waitFor({ state: 'visible' })
  const workspaceCrumb = moveDialog.locator('.move-dialog-breadcrumbs button').first()
  await workspaceCrumb.click()
  await parentFolderRow.waitFor({ state: 'visible' })

  const moveSearch = moveDialog.locator('.move-dialog-search input')
  await moveSearch.fill('folder that does not exist')
  assert(await moveButton.isDisabled(), 'Move here should be disabled when search has no results')
  await moveSearch.fill('00 Deep')
  const deepResult = moveDialog.locator('.move-dialog-row', { hasText: '00 Deep' })
  await deepResult.waitFor({ state: 'visible' })
  assert.equal(
    await deepResult.locator('.move-dialog-row-path').innerText(),
    '00 Parent / 00 Child / 00 Target',
    'search results should show the complete parent path',
  )
  assert(!(await moveButton.isDisabled()), 'the highlighted search result should be confirmable')
  assert.equal(
    await moveDialog.locator('.move-dialog-destination strong').innerText(),
    '00 Parent / 00 Child / 00 Target / 00 Deep',
  )
  const searchListBox = await moveList.boundingBox()
  assert(
    searchListBox?.height === 36,
    `single search result should use a 36px list, got ${searchListBox?.height}`,
  )
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true })
  await moveSearch.press('Enter')
  await moveDialog.waitFor({ state: 'detached', timeout: 10000 })
  const movedPath = path.join(
    workspace,
    '00 Parent',
    '00 Child',
    '00 Target',
    '00 Deep',
    'external-added.md',
  )
  await waitUntil('Move To should move the file on disk', () => fs.existsSync(movedPath))
  assert(!fs.existsSync(externalPath), 'the old source path should be gone after moving')
  const activeTabPath = await page.locator('.ed-tab[data-active="true"]').getAttribute('title')
  assert(
    activeTabPath?.endsWith('/00 Parent/00 Child/00 Target/00 Deep/external-added.md'),
    `active tab did not follow the moved file: ${activeTabPath}`,
  )
  await waitUntil('moved active note should remain open', async () =>
    (await page.locator('.ProseMirror').innerText()).includes('ceruleanwatchertoken'),
  )

  await sleep(500)
  const combinedLogs = logs.join('')
  assert(!/EMFILE|too many open files/i.test(combinedLogs), `unexpected EMFILE:\n${combinedLogs}`)
  assert(
    !/Skipping inaccessible file:.*mysql\.sock/i.test(combinedLogs),
    `Unix socket should be ignored without an accessibility warning:\n${combinedLogs}`,
  )
  assert(
    !/javascript heap out of memory|allocation failure/i.test(combinedLogs),
    'renderer OOM detected',
  )
  assert(!/renderer:pageerror/i.test(combinedLogs), `renderer page error:\n${combinedLogs}`)

  const rssKb = Number(
    execFileSync('ps', ['-o', 'rss=', '-p', String(app.process().pid)], {
      encoding: 'utf8',
    }).trim(),
  )
  console.log(
    JSON.stringify(
      {
        ok: true,
        folders: LARGE_FOLDER_COUNT,
        seededFiles: LARGE_FOLDER_COUNT * 3 + 42,
        elapsedMs: Date.now() - startedAt,
        mainProcessRssMb: Math.round(rssKb / 1024),
        moveRowsMounted: mountedAtTop,
        smartRowsMounted: mountedSmartRows,
        smartResultsScrollHeight: smartHeight,
        moveDialogWidth: Math.round(dialogBox.width),
        moveDialogHeight: Math.round(dialogBox.height),
        screenshot: screenshotPath ?? null,
      },
      null,
      2,
    ),
  )
}

try {
  await run()
} catch (error) {
  console.error(error)
  if (logs.length) console.error('\n--- Electron logs ---\n' + logs.join(''))
  if (app) {
    const pages = app.windows()
    if (pages[0]) {
      await pages[0]
        .screenshot({ path: path.join(testRoot, 'failure.png'), fullPage: true })
        .catch(() => {})
      console.error(`Failure screenshot: ${path.join(testRoot, 'failure.png')}`)
    }
  }
  process.exitCode = 1
} finally {
  // macOS apps stay alive after their last window closes. Terminate only this
  // Playwright-owned Electron process so the test never lingers in the Dock.
  if (app) await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {})
  if (socketServer) {
    await new Promise((resolve) => socketServer.close(resolve)).catch(() => {})
  }
  if (process.exitCode) console.error(`Preserved E2E files for diagnosis: ${testRoot}`)
  else fs.rmSync(testRoot, { recursive: true, force: true })
}
