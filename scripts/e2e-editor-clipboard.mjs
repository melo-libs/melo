import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'melo-clipboard-e2e-')))
const workspace = path.join(root, 'workspace')
const profile = path.join(root, 'profile')
const logs = []
let app
let imageBuffer
const pendingImages = new Set()
const imageServer = createServer((_request, response) => {
  pendingImages.add(response)
  response.on('close', () => pendingImages.delete(response))
})
const releaseImages = () => {
  for (const response of pendingImages) {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
    response.end(imageBuffer)
  }
}

async function waitUntil(label, check, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${label} timed out`)
}

try {
  await new Promise((resolve) => imageServer.listen(0, '127.0.0.1', resolve))
  fs.mkdirSync(path.join(workspace, '.assets'), { recursive: true })
  fs.mkdirSync(profile)
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ lastDirectory: workspace }),
  )
  fs.writeFileSync(path.join(workspace, 'clipboard.md'), '# Clipboard regression\n\nStart here.\n')
  app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot],
    cwd: projectRoot,
    env: { ...process.env, MELO_USER_DATA: profile, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  app.process().stderr?.on('data', (chunk) => logs.push(String(chunk)))
  const page = await app.firstWindow()
  page.on('pageerror', (error) => logs.push(`[pageerror] ${error.stack}`))
  await page
    .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'clipboard' }) })
    .first()
    .click()
  await page.locator('.ProseMirror').waitFor()
  const png = await app.evaluate(({ nativeImage }) =>
    Array.from(
      nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 }).toPNG(),
    ),
  )
  fs.writeFileSync(path.join(workspace, '.assets', 'red.png'), Buffer.from(png))
  imageBuffer = Buffer.from(png)
  // Keep displayed images immediate; only the main-process clipboard fetch is delayed.
  await page.route(`http://127.0.0.1:${imageServer.address().port}/**`, (route) =>
    route.fulfill({ contentType: 'image/png', body: imageBuffer }),
  )
  const setDocument = (doc) =>
    page.evaluate((doc) => {
      const editor = document.querySelector('.ProseMirror').editor
      editor.commands.setContent(doc)
      editor.commands.selectAll()
      editor.view.focus()
      return editor.getJSON()
    }, doc)
  const currentDocument = () =>
    page.evaluate(() => document.querySelector('.ProseMirror').editor.getJSON())
  const readClipboard = () =>
    app.evaluate(({ clipboard }) => ({
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      image: !clipboard.readImage().isEmpty(),
      formats: clipboard.availableFormats(),
    }))
  let nativeMenuClicks = 0
  const copyMarkdown = async () => {
    const native = await app.evaluate(({ BrowserWindow, Menu }) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (BrowserWindow.getFocusedWindow() === window) {
        Menu.getApplicationMenu().getMenuItemById('copy-as-markdown').click()
        return true
      }
      // Headless macOS may give Chromium focus without an active native window.
      // The menu's focused-window guard is separately covered by menu.test.ts.
      window.webContents.send('on-copy-as-markdown')
      return false
    })
    if (native) nativeMenuClicks++
  }
  const copy = async (cut = false) => {
    await page.locator('.ProseMirror').evaluate((element) => element.editor.view.focus())
    await app.evaluate(({ clipboard, BrowserWindow }, cut) => {
      clipboard.writeText('clipboard-sentinel')
      const win = BrowserWindow.getAllWindows()[0]
      win.focus()
      if (cut) win.webContents.cut()
      else win.webContents.copy()
    }, cut)
    await waitUntil(
      'native copy should replace the clipboard',
      async () => (await readClipboard()).text !== 'clipboard-sentinel',
    )
    return readClipboard()
  }
  const paste = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste())
  const text = (value) => ({ type: 'text', text: value })
  const paragraph = (...content) => ({ type: 'paragraph', content })
  const source = {
    type: 'doc',
    content: [
      paragraph(text('1. literal # heading *literal* C:\\notes\\file')),
      paragraph(
        text('Link '),
        { type: 'wikilink', attrs: { target: 'Target', label: 'Alias' } },
        text(' and '),
        { type: 'inlineMath', attrs: { latex: 'x^2' } },
        text(' and '),
        { type: 'wikilink', attrs: { target: 'Unlabelled' } },
      ),
      { type: 'blockMath', attrs: { latex: 'y = x' } },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [paragraph(text('Done'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [paragraph(text('Pending'))] },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [paragraph(text('A'))] },
              { type: 'tableHeader', content: [paragraph(text('B'))] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [paragraph(text('One'))] },
              { type: 'tableCell', content: [paragraph(text('Two'))] },
            ],
          },
        ],
      },
    ],
  }
  const expected = await setDocument(source)
  const copied = await copy()
  assert(copied.text.includes('1. literal # heading *literal* C:\\notes\\file'))
  assert(copied.text.includes('Alias and $x^2$'))
  assert(copied.text.includes('$$y = x$$'))
  assert(copied.text.includes('☑ Done\n☐ Pending'))
  assert(copied.text.includes('A\tB\nOne\tTwo'))
  assert(copied.html.includes('data-pm-slice'))
  assert(copied.html.includes('$x^2$'), 'HTML must retain a visible math fallback')
  await setDocument({ type: 'doc', content: [paragraph()] })
  await paste()
  await waitUntil(
    'Melo copy/paste should preserve the entire schema document',
    async () => JSON.stringify(await currentDocument()) === JSON.stringify(expected),
  )

  const literal = {
    type: 'doc',
    content: [
      paragraph(text('# literal')),
      paragraph(text('1. literal')),
      paragraph(text('*literal* \\path')),
    ],
  }
  const literalExpected = await setDocument(literal)
  await copy()
  await setDocument({ type: 'doc', content: [paragraph()] })
  await paste()
  await waitUntil(
    'paragraph-only copies must not be reinterpreted as Markdown',
    async () => JSON.stringify(await currentDocument()) === JSON.stringify(literalExpected),
  )

  await setDocument(literal)
  await waitUntil('the native Markdown menu should be enabled for a selection', () =>
    app.evaluate(
      ({ Menu }) => Menu.getApplicationMenu().getMenuItemById('copy-as-markdown').enabled,
    ),
  )
  await copyMarkdown()
  await waitUntil('explicit Markdown copy should preserve escaping', async () =>
    (await readClipboard()).text.includes('1\\. literal'),
  )
  const selectedBeforeFallback = await page.locator('.ProseMirror').evaluate((element) => {
    window.clipboardWriteText = navigator.clipboard.writeText
    navigator.clipboard.writeText = async () => {
      throw new Error('Clipboard API unavailable')
    }
    return element.editor.state.selection.toJSON()
  })
  await app.evaluate(({ clipboard }) => clipboard.writeText('fallback-sentinel'))
  await copyMarkdown()
  await waitUntil('Markdown copy should work without the Clipboard API', async () =>
    (await readClipboard()).text.includes('1\\. literal'),
  )
  await page.waitForFunction(() => document.querySelector('.ProseMirror').editor.view.hasFocus())
  assert.deepEqual(
    await page.locator('.ProseMirror').evaluate((element) => {
      navigator.clipboard.writeText = window.clipboardWriteText
      delete window.clipboardWriteText
      return element.editor.state.selection.toJSON()
    }),
    selectedBeforeFallback,
  )
  assert(
    !(await readClipboard()).html.includes('data-pm-slice'),
    'explicit Markdown copy must not retain a stale HTML representation',
  )
  assert(
    !(await readClipboard()).formats.includes('text/html'),
    'Markdown copy should write text/plain only',
  )
  await page
    .locator('.sidebar-search')
    .count()
    .then(async (count) => {
      const input = page.getByPlaceholder('Search workspace...')
      if (count && (await input.count())) await input.click()
      else
        await page.locator('.ProseMirror').evaluate((element) => {
          const input = document.createElement('input')
          input.id = 'clipboard-other-input'
          element.parentElement.append(input)
          input.focus()
        })
    })
  await waitUntil('another input should disable Markdown copy', () =>
    app.evaluate(
      ({ Menu }) => !Menu.getApplicationMenu().getMenuItemById('copy-as-markdown').enabled,
    ),
  )
  const beforeOtherInput = await readClipboard()
  await copyMarkdown()
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.deepEqual(await readClipboard(), beforeOtherInput)
  await setDocument(literal)
  await page.locator('.ProseMirror').evaluate((element) => {
    element.editor.setEditable(false)
    element.blur()
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = document.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await waitUntil('a visible read-only note selection should enable Markdown copy', () =>
    app.evaluate(
      ({ Menu }) => Menu.getApplicationMenu().getMenuItemById('copy-as-markdown').enabled,
    ),
  )
  await app.evaluate(({ clipboard }) => clipboard.writeText('read-only-sentinel'))
  await copyMarkdown()
  await waitUntil('a visible read-only note should copy as Markdown', async () =>
    (await readClipboard()).text.includes('1\\. literal'),
  )
  await page.locator('.ProseMirror').evaluate((element) => element.editor.setEditable(true))

  const imageDoc = {
    type: 'doc',
    content: [paragraph({ type: 'image', attrs: { src: '.assets/red.png', alt: 'Red pixel' } })],
  }
  const expectedImage = await setDocument(imageDoc)
  assert((await copy()).image, 'select-all containing only one image should include native pixels')
  await page
    .locator('.ProseMirror')
    .evaluate((element) => element.editor.commands.setNodeSelection(1))
  const imageCopy = await copy()
  assert(imageCopy.image, 'single-image copy must include native bitmap data')
  assert(imageCopy.html.includes('data:image/png;base64,'))
  assert.equal(imageCopy.text, 'Red pixel')
  await setDocument({ type: 'doc', content: [paragraph()] })
  await paste()
  await waitUntil(
    'internal image paste must reuse the asset and insert it once',
    async () => JSON.stringify(await currentDocument()) === JSON.stringify(expectedImage),
  )
  await page
    .locator('.ProseMirror')
    .evaluate((element) => element.editor.commands.setNodeSelection(1))
  await app.evaluate(({ clipboard }) => clipboard.writeText('image-button-sentinel'))
  await page.getByRole('button', { name: 'Copy image', exact: true }).click()
  await waitUntil('Copy image should include pixels and alt text', async () => {
    const data = await readClipboard()
    return data.image && data.text === 'Red pixel'
  })
  await copyMarkdown()
  await waitUntil('Markdown copy should accept an image NodeSelection', async () =>
    (await readClipboard()).text.includes('![Red pixel](.assets/red.png)'),
  )

  const mixed = {
    type: 'doc',
    content: [paragraph(text('Before image')), ...imageDoc.content, paragraph(text('After image'))],
  }
  const mixedExpected = await setDocument(mixed)
  const mixedCopy = await copy()
  assert(mixedCopy.html.includes('data:image/png;base64,'))
  assert(mixedCopy.text.includes('Red pixel'))
  await setDocument({ type: 'doc', content: [paragraph()] })
  await paste()
  await waitUntil(
    'mixed content should round-trip without duplicate images',
    async () => JSON.stringify(await currentDocument()) === JSON.stringify(mixedExpected),
  )
  await page.evaluate(() => {
    const target = document.createElement('div')
    target.contentEditable = 'true'
    target.id = 'rich-target'
    document.body.append(target)
    target.focus()
  })
  await paste()
  await waitUntil('a rich-text target should receive the embedded image', () =>
    page.locator('#rich-target img').count(),
  )
  assert((await page.locator('#rich-target').innerText()).includes('Before image'))
  assert((await page.locator('#rich-target img').getAttribute('src')).startsWith('data:image/png'))
  await page.locator('#rich-target').evaluate((target) => target.remove())
  await page.evaluate(() => {
    const target = document.createElement('textarea')
    target.id = 'plain-target'
    document.body.append(target)
    target.focus()
  })
  await paste()
  await waitUntil(
    'a plain-text target should receive readable text',
    async () => (await page.locator('#plain-target').inputValue()) === mixedCopy.text,
  )
  await page.locator('#plain-target').evaluate((target) => target.remove())

  const foreignHtml = mixedCopy.html
    .replace(/data-melo-image-workspace="[^"]*"/g, 'data-melo-image-workspace="another-workspace"')
    .replace('<img ', '<img onload="window.clipboardImportExecuted=true" ')
  await app.evaluate(
    ({ clipboard }, html) =>
      clipboard.write({ text: 'Before image\nRed pixel\nAfter image', html }),
    foreignHtml,
  )
  await setDocument({ type: 'doc', content: [paragraph()] })
  await paste()
  await waitUntil('images copied from another workspace should be imported as assets', async () => {
    const doc = await currentDocument()
    const src = doc.content[1]?.content?.[0]?.attrs?.src
    return src?.startsWith('.assets/') && src !== '.assets/red.png'
  })
  const importedDoc = await currentDocument()
  const importedSrc = importedDoc.content[1].content[0].attrs.src
  assert(fs.existsSync(path.join(workspace, importedSrc)))
  const importedExpected = structuredClone(mixedExpected)
  importedExpected.content[1].content[0].attrs.src = importedSrc
  assert.deepEqual(importedDoc, importedExpected)
  assert(!JSON.stringify(importedDoc).includes('data:image/'))
  assert.equal(
    await page.evaluate(() => window.clipboardImportExecuted),
    undefined,
    'clipboard HTML event handlers must remain inert',
  )

  const readOnlyTarget = await setDocument({
    type: 'doc',
    content: [paragraph(text('Read-only target'))],
  })
  await page.locator('.ProseMirror').evaluate((element, html) => {
    element.editor.view.pasteHTML(html)
    element.editor.setEditable(false)
  }, foreignHtml)
  await page.locator('.toast', { hasText: 'Document or selection changed' }).waitFor()
  assert.deepEqual(
    await currentDocument(),
    readOnlyTarget,
    'a pending image paste must respect a new read-only lock',
  )
  await page.locator('.ProseMirror').evaluate((element) => element.editor.setEditable(true))

  const dropTarget = await setDocument({
    type: 'doc',
    content: [paragraph(text('Keep before')), paragraph(text('Keep after'))],
  })
  const embedded = `data:image/png;base64,${imageBuffer.toString('base64')}`
  await new Promise((resolve) => setTimeout(resolve, 600))
  await page.locator('.ProseMirror').evaluate((element, src) => {
    const data = new DataTransfer()
    data.setData('text/html', `<p>Dragged <img src="${src}" alt="Dropped pixel"></p>`)
    const rect = element.getBoundingClientRect()
    element.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: rect.left + 10,
        clientY: rect.top + 10,
      }),
    )
  }, embedded)
  await waitUntil('HTML image drop should import pixels into .assets', async () =>
    JSON.stringify(await currentDocument()).includes('.assets/'),
  )
  const dropped = JSON.stringify(await currentDocument())
  assert(dropped.includes('Keep before') && dropped.includes('Keep after'))
  assert(!dropped.includes('data:image/'))
  assert(
    await page
      .locator('.ProseMirror')
      .evaluate((element) => !element.editor.getMarkdown().includes('data:image/')),
  )
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  await waitUntil(
    'image drop should undo as one insertion',
    async () => JSON.stringify(await currentDocument()) === JSON.stringify(dropTarget),
  )

  fs.writeFileSync(path.join(workspace, '.assets', 'a b#c.png'), imageBuffer)
  await setDocument({
    type: 'doc',
    content: [
      paragraph({ type: 'image', attrs: { src: '.assets/a%20b%23c.png', alt: 'Encoded' } }),
    ],
  })
  await waitUntil('encoded image should display', () =>
    page.locator('.ProseMirror img[src]').evaluate((image) => image.naturalWidth > 0),
  )
  assert((await copy()).image, 'a displayed URL-encoded image should also copy')

  await setDocument({
    type: 'doc',
    content: [
      {
        type: 'codeBlock',
        attrs: { language: 'javascript' },
        content: [text('  const value = 1\n    next()')],
      },
    ],
  })
  // The existing chrome is hover-only; exercise its clipboard handler independently of hover.
  await page.locator('.cb-copy').evaluate((button) => button.click())
  await waitUntil(
    'Copy code should keep raw indentation without fences',
    async () => (await readClipboard()).text === '  const value = 1\n    next()',
  )

  await setDocument(imageDoc)
  await page
    .locator('.ProseMirror')
    .evaluate((element) => element.editor.commands.setNodeSelection(1))
  await new Promise((resolve) => setTimeout(resolve, 600))
  await copy(true)
  await waitUntil(
    'image cut must delete only after a successful clipboard write',
    async () => !JSON.stringify(await currentDocument()).includes('.assets/red.png'),
  )
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  await waitUntil(
    'image cut should undo normally',
    async () => JSON.stringify(await currentDocument()) === JSON.stringify(expectedImage),
  )

  const missingImage = await setDocument({
    type: 'doc',
    content: [paragraph({ type: 'image', attrs: { src: '.assets/missing.png' } })],
  })
  await page
    .locator('.ProseMirror')
    .evaluate((element) => element.editor.commands.setNodeSelection(1))
  await app.evaluate(({ clipboard, BrowserWindow }) => {
    clipboard.writeText('failed-copy-sentinel')
    BrowserWindow.getAllWindows()[0].webContents.cut()
  })
  await page.locator('.toast', { hasText: 'Could not copy' }).waitFor()
  assert.equal((await readClipboard()).text, 'failed-copy-sentinel')
  assert.deepEqual(await currentDocument(), missingImage)

  const remoteImage = (name) => ({
    type: 'doc',
    content: [
      paragraph({
        type: 'image',
        attrs: {
          src: `http://127.0.0.1:${imageServer.address().port}/${name}.png`,
          alt: 'Slow image',
        },
      }),
    ],
  })
  await setDocument(remoteImage('switch-window'))
  await app.evaluate(({ clipboard, BrowserWindow }) => {
    clipboard.writeText('switch-window-sentinel')
    BrowserWindow.getAllWindows()[0].webContents.copy()
  })
  await waitUntil('switch-window copy should start loading', () => pendingImages.size > 0)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  releaseImages()
  await waitUntil(
    'blur alone must not cancel an image copy',
    async () => (await readClipboard()).image,
  )

  await setDocument(remoteImage('external-newer-copy'))
  await app.evaluate(({ clipboard, BrowserWindow }) => {
    clipboard.writeText('initial-external-sentinel')
    BrowserWindow.getAllWindows()[0].webContents.copy()
  })
  await waitUntil('external-newer copy should start loading', () => pendingImages.size > 0)
  // A clipboard update outside this renderer does not increment its local copy guard.
  await app.evaluate(({ clipboard }) => clipboard.writeText('newer-external-copy'))
  releaseImages()
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.equal((await readClipboard()).text, 'newer-external-copy')

  await setDocument(remoteImage('cancelled'))
  await page
    .locator('.ProseMirror')
    .evaluate((element) => element.editor.commands.setNodeSelection(1))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.copy())
  await waitUntil('remote image copy should be fetching pixels', () => pendingImages.size > 0)
  await setDocument(literal)
  const latestCopy = await copy()
  releaseImages()
  await new Promise((resolve) => setTimeout(resolve, 600))
  assert.deepEqual(
    await readClipboard(),
    latestCopy,
    'a slow image copy must not overwrite a newer copy',
  )

  await setDocument(remoteImage('changed-selection'))
  await page
    .locator('.ProseMirror')
    .evaluate((element) => element.editor.commands.setNodeSelection(1))
  await app.evaluate(({ clipboard, BrowserWindow }) => {
    clipboard.writeText('slow-cut-sentinel')
    BrowserWindow.getAllWindows()[0].webContents.cut()
  })
  await waitUntil('remote image cut should be fetching pixels', () => pendingImages.size > 0)
  await setDocument(literal)
  releaseImages()
  await waitUntil(
    'the original image should still be copied',
    async () => (await readClipboard()).image,
  )
  assert.deepEqual(
    await currentDocument(),
    literalExpected,
    'a pending cut must not delete changed content',
  )

  await setDocument(literal)
  // Separate the fixture replacement from the user's cut history group.
  await new Promise((resolve) => setTimeout(resolve, 600))
  await copy(true)
  await waitUntil(
    'cut should remove the selected content',
    async () =>
      !(await currentDocument()).content.some((node) =>
        node.content?.some((child) => child.text === '# literal'),
      ),
  )
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  await waitUntil(
    'cut should undo normally',
    async () => JSON.stringify(await currentDocument()) === JSON.stringify(literalExpected),
  )
  assert(!logs.some((line) => line.includes('[pageerror]')), logs.join('\n'))
  console.log(
    JSON.stringify(
      {
        ok: true,
        nativeMenuClicks,
        coverage: [
          'native clipboard text/HTML/image',
          'internal round trips',
          'literal punctuation',
          'math/wikilinks',
          'tasks/tables',
          'Markdown command scope and menu availability',
          'read-only selection',
          'image and mixed HTML',
          'foreign image asset import',
          'raw code copy',
          'cut/undo',
          'failed image cut',
          'asynchronous copy/cut races',
          'read-only image import lock',
          'HTML image drop and undo',
          'encoded asset paths',
          'select-all image bitmap',
          'window blur and external clipboard updates',
        ],
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(error)
  console.error(logs.join('\n'))
  if (app)
    console.error(
      await app.evaluate(({ BrowserWindow, Menu, clipboard }) => ({
        focusedWindow: BrowserWindow.getFocusedWindow()?.id,
        mainWindow: BrowserWindow.getAllWindows()[0]?.id,
        markdownEnabled: Menu.getApplicationMenu()?.getMenuItemById('copy-as-markdown')?.enabled,
        clipboard: clipboard.readText(),
      })),
    )
  if (app)
    console.error(
      await app.windows()[0]?.evaluate(() => ({
        hasFocus: document.hasFocus(),
        active: document.activeElement?.tagName,
        selection: document.querySelector('.ProseMirror')?.editor.state.selection.toJSON(),
      })),
    )
  if (app)
    console.error(
      await app
        .windows()[0]
        ?.evaluate(() => document.querySelector('.ProseMirror')?.editor.getJSON()),
    )
  if (app)
    await app
      .windows()[0]
      ?.screenshot({ path: path.join(root, 'failure.png') })
      .catch(() => {})
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
  imageServer.closeAllConnections()
  await new Promise((resolve) => imageServer.close(resolve))
  if (!process.exitCode)
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
