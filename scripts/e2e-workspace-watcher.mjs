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
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-watcher-e2e-'))
const workspace = path.join(testRoot, 'workspace')
const profile = path.join(testRoot, 'profile')
const LARGE_FOLDER_COUNT = Number(process.env.MELO_E2E_FOLDER_COUNT ?? 2500)
const screenshotPath = process.env.MELO_E2E_SCREENSHOT
const browseScreenshotPath = process.env.MELO_E2E_BROWSE_SCREENSHOT
const clipScreenshotPath = process.env.MELO_E2E_CLIP_SCREENSHOT
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
    note('Captured', 'A note with source metadata.', 'https://www.example.com/article'),
  )
  fs.writeFileSync(path.join(workspace, 'delete-me.md'), note('Delete Me', 'Remove externally.'))
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
  assert.equal(
    await page.locator('.ws-opener').count(),
    0,
    'workspace should restore without a dialog',
  )
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
        seededFiles: LARGE_FOLDER_COUNT * 3 + 2,
        elapsedMs: Date.now() - startedAt,
        mainProcessRssMb: Math.round(rssKb / 1024),
        moveRowsMounted: mountedAtTop,
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
