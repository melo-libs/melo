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
let missingImageRequests = 0
let redirectLoopRequests = 0
const imageServer = createServer((request, response) => {
  // DOMSerializer can load <img> in a detached document outside page.route.
  // Delay only main-process fetches, never those incidental display requests.
  if (request.headers['sec-fetch-dest'] === 'image') {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
    response.end(imageBuffer)
    return
  }
  if (request.url === '/missing.png') {
    missingImageRequests++
    response.writeHead(404)
    response.end()
    return
  }
  if (request.url === '/redirect-image.png' || request.url === '/redirect-loop.png') {
    const loop = request.url === '/redirect-loop.png'
    if (loop) redirectLoopRequests++
    response.writeHead(302, { Location: loop ? '/redirect-loop.png' : '/immediate-image.png' })
    response.end()
    return
  }
  if (request.url === '/immediate-image.png') {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    response.end(imageBuffer)
    return
  }
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
  await app.evaluate(({ clipboard, BrowserWindow }) => {
    globalThis.clipboardEditorWindow = BrowserWindow.getAllWindows()[0]
    clipboard.writeText('melo-clipboard-e2e-initial')
    const write = clipboard.write.bind(clipboard)
    globalThis.clipboardWrites = 0
    globalThis.failClipboardWrite = false
    clipboard.write = (data) => {
      if (globalThis.failClipboardWrite) {
        globalThis.failClipboardWrite = false
        throw new Error('Simulated clipboard write failure')
      }
      globalThis.clipboardWrites++
      return write(data)
    }
  })
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
      const window = globalThis.clipboardEditorWindow
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
  const copy = async (cut = false, enhanced = false) => {
    await page.locator('.ProseMirror').evaluate((element, cut) => {
      window.clipboardCopyCompleted = false
      document.addEventListener(
        cut ? 'cut' : 'copy',
        () => {
          setTimeout(() => {
            window.clipboardCopyCompleted = true
          }, 0)
        },
        { once: true, capture: true },
      )
      element.editor.view.focus()
    }, cut)
    await app.evaluate(({ clipboard }, cut) => {
      clipboard.writeText('clipboard-sentinel')
      globalThis.clipboardWrites = 0
      const win = globalThis.clipboardEditorWindow
      win.focus()
      if (cut) win.webContents.cut()
      else win.webContents.copy()
    }, cut)
    await page.waitForFunction(() => window.clipboardCopyCompleted)
    await waitUntil(
      'native copy should replace the clipboard',
      async () => (await readClipboard()).text !== 'clipboard-sentinel',
    )
    if (enhanced) {
      await waitUntil('image enhancement should finish', async () =>
        (await readClipboard()).html.includes('data:image/'),
      )
      if (enhanced === 'background') {
        await waitUntil(
          'background image decoding should finish',
          async () => (await readClipboard()).image,
        )
      }
    }
    const result = await readClipboard()
    if (enhanced) {
      assert.equal(
        await app.evaluate(() => globalThis.clipboardWrites),
        enhanced === 'background' ? 2 : 1,
        'only background codecs need a guarded second write',
      )
      assert(
        !result.html.includes('data-melo-copy-id'),
        'completed copies must remove temporary copy IDs',
      )
    }
    return result
  }
  const paste = () => app.evaluate(() => globalThis.clipboardEditorWindow.webContents.paste())
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
  await app.evaluate(({ ipcMain }) => {
    globalThis.clipboardAvailabilityMessages = 0
    globalThis.clipboardAvailabilityListener = () => globalThis.clipboardAvailabilityMessages++
    ipcMain.on('copy-markdown-available', globalThis.clipboardAvailabilityListener)
  })
  await page.locator('.ProseMirror').evaluate((element) => {
    for (let index = 0; index < 20; index++) {
      element.editor.commands.setTextSelection({ from: 1, to: index % 2 ? 3 : 4 })
      document.dispatchEvent(new Event('selectionchange'))
    }
    element.editor.commands.selectAll()
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(await app.evaluate(() => globalThis.clipboardAvailabilityMessages), 0)
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeListener('copy-markdown-available', globalThis.clipboardAvailabilityListener)
    delete globalThis.clipboardAvailabilityMessages
    delete globalThis.clipboardAvailabilityListener
  })
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
  assert(
    (await copy(false, true)).image,
    'select-all containing only one image should include native pixels',
  )
  await page
    .locator('.ProseMirror')
    .evaluate((element) => element.editor.commands.setNodeSelection(1))
  const imageCopy = await copy(false, true)
  assert(imageCopy.image, 'single-image copy must include native bitmap data')
  assert(imageCopy.html.includes('data:image/png;base64,'))
  assert.equal(imageCopy.text, 'Red pixel')
  const parsedOutsideClipboard = await page.evaluate((html) => {
    const editor = document.querySelector('.ProseMirror').editor
    editor.commands.setContent(html, { contentType: 'html' })
    return editor.getJSON()
  }, imageCopy.html)
  assert(
    parsedOutsideClipboard.content[0].content[0].attrs.src.startsWith('data:image/png;'),
    'setContent HTML parsing must not consult workspace clipboard provenance',
  )
  const rowFragment = await page.evaluate((html) => {
    const view = document.querySelector('.ProseMirror').editor.view
    return view.someProp('transformPastedHTML', (transform) =>
      transform(`<tr data-pm-slice="1 1 []"><td>${html}</td></tr>`, view),
    )
  }, imageCopy.html)
  assert(rowFragment.includes('<tr data-pm-slice="1 1 []">'))
  assert(rowFragment.includes('src=".assets/red.png"'), 'table fragments must restore local assets')
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
  const mixedCopy = await copy(false, true)
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

  const externalImageUrl = `http://127.0.0.1:${imageServer.address().port}/external.png`
  const externalTableHtml =
    '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>One</td><td>Two</td></tr></tbody></table>'
  const writeHtmlAndBitmap = (html, text = '') =>
    app.evaluate(
      ({ clipboard, nativeImage }, { html, text, bytes }) => {
        clipboard.write({ html, text, image: nativeImage.createFromBuffer(Buffer.from(bytes)) })
      },
      { html, text, bytes: png },
    )

  await setDocument({ type: 'doc', content: [paragraph()] })
  await writeHtmlAndBitmap(
    `<p>Before external image</p><p><img src="${externalImageUrl}" alt="External"></p><p>After external image</p>`,
    'Before external image\nAfter external image',
  )
  await paste()
  await waitUntil('HTML and bitmap paste should keep the surrounding text', async () =>
    JSON.stringify(await currentDocument()).includes('After external image'),
  )
  const externalMixed = await currentDocument()
  assert.equal(externalMixed.content[0].content[0].text, 'Before external image')
  assert.equal(externalMixed.content[1].content[0].attrs.src, externalImageUrl)
  assert.equal(externalMixed.content[2].content[0].text, 'After external image')

  await setDocument({ type: 'doc', content: [paragraph()] })
  await writeHtmlAndBitmap(externalTableHtml, 'A\tB\nOne\tTwo')
  await paste()
  await waitUntil(
    'table HTML should win over its bitmap preview',
    async () => (await currentDocument()).content[0].type === 'table',
  )
  const externalTable = JSON.stringify(await currentDocument())
  assert(externalTable.includes('One') && externalTable.includes('Two'))
  assert(!externalTable.includes('"type":"image"'))

  await setDocument({ type: 'doc', content: [paragraph()] })
  await writeHtmlAndBitmap(
    '<p># literal heading</p><p>1. literal item</p>',
    '# literal heading\n1. literal item',
  )
  await paste()
  await waitUntil(
    'HTML text should not be reinterpreted as Markdown when a bitmap is also present',
    async () => JSON.stringify(await currentDocument()).includes('# literal heading'),
  )
  const externalLiteral = await currentDocument()
  assert.deepEqual(
    externalLiteral.content.map((node) => node.type),
    ['paragraph', 'paragraph'],
  )
  assert.equal(externalLiteral.content[1].content[0].text, '1. literal item')

  await setDocument({ type: 'doc', content: [paragraph()] })
  await app.evaluate(({ clipboard }) =>
    clipboard.write({
      text: '# literal heading\n1. literal item',
      html: '<p># literal heading</p><p>1. literal item</p>',
    }),
  )
  await paste()
  await waitUntil(
    'paragraph HTML should stay literal without an accompanying bitmap',
    async () => JSON.stringify(await currentDocument()) === JSON.stringify(externalLiteral),
  )

  await setDocument({ type: 'doc', content: [paragraph(text('Replace me'))] })
  await app.evaluate(({ clipboard }) =>
    clipboard.write({ text: 'Actual clipboard text', html: '<p><br></p>' }),
  )
  await paste()
  await waitUntil(
    'empty HTML should not discard the usable text flavor',
    async () =>
      JSON.stringify(await currentDocument()) ===
      JSON.stringify({ type: 'doc', content: [paragraph(text('Actual clipboard text'))] }),
  )

  for (const html of [`<p><img src="${externalImageUrl}" alt="Only image"></p>`, '<p><br></p>']) {
    await setDocument({ type: 'doc', content: [paragraph()] })
    await writeHtmlAndBitmap(html, 'Image alt fallback')
    await paste()
    await waitUntil('a single image or empty HTML should still import its bitmap', async () =>
      JSON.stringify(await currentDocument()).includes('.assets/'),
    )
    const standalone = await currentDocument()
    assert.equal(standalone.content[0].content[0].type, 'image')
    assert(fs.existsSync(path.join(workspace, standalone.content[0].content[0].attrs.src)))
    assert(!JSON.stringify(standalone).includes(externalImageUrl))
  }

  await setDocument({ type: 'doc', content: [paragraph(text('Drop target'))] })
  await page.locator('.ProseMirror').evaluate(
    (element, { html, bytes }) => {
      const data = new DataTransfer()
      data.items.add(new File([new Uint8Array(bytes)], 'preview.png', { type: 'image/png' }))
      data.setData('text/html', html)
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
    },
    { html: externalTableHtml, bytes: png },
  )
  await waitUntil('a mixed HTML and bitmap drop should retain the table', async () =>
    (await currentDocument()).content.some((node) => node.type === 'table'),
  )
  const tableDrop = JSON.stringify(await currentDocument())
  assert(tableDrop.includes('Drop target') && tableDrop.includes('One'))
  assert(!tableDrop.includes('"type":"image"'))

  const normalizedSave = await page.evaluate(
    async ({ bytes, workspace }) =>
      window.api.invoke('invoke-save-pasted-image', {
        imageBuffer: new Uint8Array(bytes),
        mimeType: 'image/png',
        workspaceRoot: `${workspace}/`,
      }),
    { bytes: png, workspace },
  )
  assert(normalizedSave.success, 'equivalent workspace paths should save successfully')
  assert(fs.existsSync(path.join(workspace, normalizedSave.data.filePath)))

  const formats = [
    [
      'vector.svg',
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>',
      ),
      'image/svg+xml',
    ],
    [
      'animated.gif',
      Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAAAAAAALAAAAAABAAEAAAIBRAAh+QQAAAAAACwAAAAAAQABAAACAkwAOw==',
        'base64',
      ),
      'image/gif',
    ],
    [
      'photo.jpg',
      Buffer.from(
        await app.evaluate(
          ({ nativeImage }, bytes) =>
            Array.from(nativeImage.createFromBuffer(Buffer.from(bytes)).toJPEG(80)),
          png,
        ),
      ),
      'image/jpeg',
    ],
  ]
  for (const [filename, bytes, mime] of formats) {
    fs.writeFileSync(path.join(workspace, '.assets', filename), bytes)
    await setDocument({
      type: 'doc',
      content: [
        paragraph(text('Original image bytes')),
        paragraph({
          type: 'image',
          attrs: { src: `.assets/${filename}` },
        }),
      ],
    })
    const result = await copy(false, true)
    assert(result.html.includes(`data:${mime};base64,${bytes.toString('base64')}`), filename)
    assert(!result.image, 'mixed HTML does not need a native bitmap')

    await setDocument({
      type: 'doc',
      content: [paragraph({ type: 'image', attrs: { src: `.assets/${filename}` } })],
    })
    const single = await copy(false, mime === 'image/jpeg' ? true : 'background')
    assert(single.image, `${filename}: single-image copy must include a native bitmap`)
    assert(single.html.includes(`data:${mime};base64,${bytes.toString('base64')}`), filename)
    assert.equal(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1,
      'the image decoder must release its hidden window',
    )
  }

  const holdNextImageDecode = () =>
    app.evaluate(({ app }) => {
      globalThis.clipboardDecoderWindow = null
      globalThis.releaseClipboardDecoder = null
      app.once('browser-window-created', (_event, window) => {
        globalThis.clipboardDecoderWindow = window
        const execute = window.webContents.executeJavaScript.bind(window.webContents)
        window.webContents.executeJavaScript = (...args) =>
          new Promise((resolve, reject) => {
            globalThis.releaseClipboardDecoder = () => execute(...args).then(resolve, reject)
          })
      })
    })
  const localGif = {
    type: 'doc',
    content: [
      paragraph({ type: 'image', attrs: { src: '.assets/animated.gif', alt: 'Local GIF' } }),
    ],
  }
  await holdNextImageDecode()
  await setDocument(localGif)
  const pendingCut = await copy(true)
  assert(!pendingCut.image, 'cut must return before the held bitmap decoder finishes')
  assert(pendingCut.html.includes('data:image/gif;base64,'))
  await waitUntil('the held codec should start in background', () =>
    app.evaluate(() => Boolean(globalThis.releaseClipboardDecoder)),
  )
  assert(
    await app.evaluate(() => !globalThis.clipboardDecoderWindow.isDestroyed()),
    'the editor must resume before codec completion or timeout',
  )
  assert(
    !JSON.stringify(await currentDocument()).includes('.assets/animated.gif'),
    'cut must remove the source after its embedded HTML has been written',
  )
  await paste()
  await waitUntil('cut content must paste immediately while the codec is held', async () =>
    JSON.stringify(await currentDocument()).includes('.assets/animated.gif'),
  )
  await app.evaluate(() => {
    globalThis.releaseClipboardDecoder()
  })
  await waitUntil(
    'the released codec should provide its bitmap',
    async () => (await readClipboard()).image,
  )
  await waitUntil('the completed codec should release its window', () =>
    app.evaluate(() => globalThis.clipboardDecoderWindow.isDestroyed()),
  )

  await holdNextImageDecode()
  await setDocument(localGif)
  await copy()
  await waitUntil('a second local codec should start', () =>
    app.evaluate(() => Boolean(globalThis.releaseClipboardDecoder)),
  )
  await setDocument({ type: 'doc', content: [paragraph(text('New copy during GIF decoding'))] })
  const duringDecode = await copy()
  await app.evaluate(() => {
    globalThis.releaseClipboardDecoder()
  })
  await waitUntil('the superseded codec should release its window', () =>
    app.evaluate(() => globalThis.clipboardDecoderWindow.isDestroyed()),
  )
  assert.deepEqual(
    await readClipboard(),
    duringDecode,
    'a local codec must not overwrite a newer copy',
  )

  await setDocument({ type: 'doc', content: [paragraph()] })
  await page.locator('.ProseMirror').evaluate(
    (element, valid) => {
      element.editor.view.pasteHTML(
        `<p>Before failed image <img src="data:image/png;base64,%%%" alt="Broken"> between <img src="${valid}" alt="Good"> after</p>`,
      )
    },
    `data:image/png;base64,${imageBuffer.toString('base64')}`,
  )
  await page.locator('.toast', { hasText: 'replaced with placeholders' }).waitFor()
  const partialImport = JSON.stringify(await currentDocument())
  assert(partialImport.includes('Before failed image'))
  assert(partialImport.includes('Image not imported: Broken'))
  assert(partialImport.includes('between') && partialImport.includes('after'))
  assert(partialImport.includes('.assets/'))
  assert(!partialImport.includes('data:image/'))

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
  assert((await copy(false, true)).image, 'a displayed URL-encoded image should also copy')

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
  await copy(true, true)
  await waitUntil(
    'image cut should remove its source selection',
    async () => !JSON.stringify(await currentDocument()).includes('.assets/red.png'),
  )
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  await waitUntil(
    'image cut should undo normally',
    async () => JSON.stringify(await currentDocument()) === JSON.stringify(expectedImage),
  )

  const failedCutSource = await setDocument(mixed)
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText('keep-on-write-failure')
    globalThis.failClipboardWrite = true
    globalThis.clipboardEditorWindow.webContents.cut()
  })
  await page.locator('.toast', { hasText: 'Could not copy' }).last().waitFor()
  assert.deepEqual(
    await currentDocument(),
    failedCutSource,
    'a failed synchronous clipboard write must not delete the source',
  )
  assert.equal((await readClipboard()).text, 'keep-on-write-failure')

  const padded = Buffer.concat([imageBuffer, Buffer.alloc(13 * 1024 * 1024)])
  fs.writeFileSync(path.join(workspace, '.assets', 'large-a.png'), padded)
  fs.writeFileSync(path.join(workspace, '.assets', 'large-b.png'), padded)
  fs.writeFileSync(path.join(workspace, '.assets', 'oversize.png'), Buffer.alloc(21 * 1024 * 1024))
  await setDocument({
    type: 'doc',
    content: [
      paragraph(text('Text survives the HTML budget')),
      ...['large-a.png', 'large-b.png', 'oversize.png'].map((name) =>
        paragraph({ type: 'image', attrs: { src: `.assets/${name}` } }),
      ),
    ],
  })
  await copy()
  await page.locator('.toast', { hasText: 'Some images were kept as references' }).last().waitFor()
  const budgetCopy = await readClipboard()
  assert(budgetCopy.text.includes('Text survives the HTML budget'))
  assert(budgetCopy.html.includes('data:image/png;base64,'))
  assert(budgetCopy.html.includes('.assets/large-b.png'))
  assert(budgetCopy.html.includes('.assets/oversize.png'))
  assert(budgetCopy.html.length <= 32 * 1024 * 1024)

  const missingImage = await setDocument({
    type: 'doc',
    content: [
      paragraph(text('Text around a broken image')),
      paragraph({ type: 'image', attrs: { src: '.assets/missing.png', alt: 'Missing' } }),
      paragraph(text('Still copied')),
    ],
  })
  await copy(true)
  await page.locator('.toast', { hasText: 'Cut. Some images were kept as references' }).waitFor()
  const partialCut = await readClipboard()
  assert(partialCut.text.includes('Text around a broken image'))
  assert(partialCut.text.includes('Still copied'))
  assert(partialCut.html.includes('.assets/missing.png'))
  assert(!JSON.stringify(await currentDocument()).includes('Text around a broken image'))
  await setDocument({ type: 'doc', content: [paragraph()] })
  await paste()
  await waitUntil(
    'fallback image references should round-trip inside Melo',
    async () => JSON.stringify(await currentDocument()) === JSON.stringify(missingImage),
  )

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
  const mixedRemote = remoteImage('missing')
  mixedRemote.content.unshift(paragraph(text('Copy without downloading remote images')))
  await setDocument(mixedRemote)
  const remoteCopy = await copy()
  assert(remoteCopy.text.includes('Copy without downloading remote images'))
  assert(remoteCopy.html.includes('/missing.png'))
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(
    missingImageRequests,
    0,
    'mixed remote images should keep their URL without fetching',
  )

  await setDocument(remoteImage('missing'))
  await copy()
  await page.locator('.toast', { hasText: 'Could not copy as an image' }).last().waitFor()
  await waitUntil('failed image reader should return', () => missingImageRequests > 0)
  assert.equal((await readClipboard()).text, 'Slow image')
  assert((await readClipboard()).html.includes('/missing.png'))
  assert(missingImageRequests > 0, 'single-image failure fixture should reach the reader')

  await setDocument(remoteImage('redirect-image'))
  await copy()
  await waitUntil(
    'a redirected generic-binary image should produce a bitmap',
    async () => (await readClipboard()).image,
  )
  assert(!(await readClipboard()).html.includes('data-melo-copy-id'))

  await setDocument(remoteImage('redirect-loop'))
  await copy()
  await waitUntil('Chromium must bound redirect loops', () => redirectLoopRequests === 21)
  await page.locator('.toast', { hasText: 'Could not copy as an image' }).last().waitFor()
  assert(!(await readClipboard()).image)
  assert((await readClipboard()).html.includes('/redirect-loop.png'))

  await setDocument(remoteImage('switch-window'))
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText('switch-window-sentinel')
    globalThis.clipboardEditorWindow.webContents.copy()
  })
  await waitUntil('switch-window copy should start loading', () => pendingImages.size > 0)
  assert.equal((await readClipboard()).text, 'Slow image')
  await page.evaluate(() => {
    const target = document.createElement('textarea')
    target.id = 'immediate-paste'
    document.body.append(target)
    target.focus()
  })
  await paste()
  await waitUntil(
    'immediate paste should receive the new copy before image loading',
    async () => (await page.locator('#immediate-paste').inputValue()) === 'Slow image',
  )
  await page.locator('#immediate-paste').evaluate((target) => target.remove())
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  releaseImages()
  await waitUntil(
    'blur alone must not cancel an image copy',
    async () => (await readClipboard()).image,
  )
  assert((await readClipboard()).html.includes('data:image/png;base64,'))

  await setDocument(remoteImage('external-newer-copy'))
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText('initial-external-sentinel')
    globalThis.clipboardEditorWindow.webContents.copy()
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
  await app.evaluate(() => globalThis.clipboardEditorWindow.webContents.copy())
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

  const quickCutDoc = remoteImage('quick-cut')
  quickCutDoc.content.push(paragraph(text('Destination')))
  await setDocument(quickCutDoc)
  await page
    .locator('.ProseMirror')
    .evaluate((element) => element.editor.commands.setNodeSelection(1))
  await copy(true)
  await waitUntil('quick cut image enhancement should be pending', () => pendingImages.size > 0)
  assert(
    !JSON.stringify(await currentDocument()).includes('quick-cut.png'),
    'the source must already be removed before image IO finishes',
  )
  await page.locator('.ProseMirror').evaluate((element) => element.editor.commands.focus('end'))
  await paste()
  await waitUntil('immediate cut/paste should move the image to the destination', async () => {
    const doc = await currentDocument()
    return doc.content[doc.content.length - 1].content?.some((node) => node.type === 'image')
  })
  const quickCutResult = await currentDocument()
  assert.equal(JSON.stringify(quickCutResult).split('quick-cut.png').length - 1, 1)
  releaseImages()
  await waitUntil('quick cut enhancement should finish', async () => (await readClipboard()).image)
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.deepEqual(
    await currentDocument(),
    quickCutResult,
    'late image enhancement must not change or duplicate moved content',
  )
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  await waitUntil(
    'undo should remove the pasted image',
    async () => !JSON.stringify(await currentDocument()).includes('quick-cut.png'),
  )
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z')
  await waitUntil(
    'redo should restore the moved image once',
    async () => JSON.stringify(await currentDocument()) === JSON.stringify(quickCutResult),
  )

  await setDocument(remoteImage('changed-selection'))
  await page
    .locator('.ProseMirror')
    .evaluate((element) => element.editor.commands.setNodeSelection(1))
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText('slow-cut-sentinel')
    globalThis.clipboardEditorWindow.webContents.cut()
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
          'failed image cut with intact clipboard references',
          'HTML and bitmap paste/drop format priority',
          'immediate image cut/paste and undo/redo',
          'single synchronous local write and failed-write cut safety',
          'single remote image fallback and asynchronous bitmap upgrade',
          'stalled local codecs: responsive editor, immediate cut/paste and newer-copy protection',
          'remote image failure and mixed URL preservation',
          'original GIF/SVG/JPEG bytes in HTML',
          'partial external image import',
          'aggregate HTML and individual image limits',
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
  console.error(`Preserved diagnostics: ${root}`)
  console.error(error)
  console.error(logs.join('\n'))
  if (app)
    console.error(
      await app
        .evaluate(({ BrowserWindow, Menu, clipboard }) => ({
          focusedWindow: BrowserWindow.getFocusedWindow()?.id,
          mainWindow: globalThis.clipboardEditorWindow?.id,
          markdownEnabled: Menu.getApplicationMenu()?.getMenuItemById('copy-as-markdown')?.enabled,
          clipboard: clipboard.readText(),
        }))
        .catch((error) => ({ diagnosticUnavailable: error.message })),
    )
  if (app)
    console.error(
      await app
        .windows()[0]
        ?.evaluate(() => ({
          hasFocus: document.hasFocus(),
          active: document.activeElement?.tagName,
          selection: document.querySelector('.ProseMirror')?.editor.state.selection.toJSON(),
        }))
        .catch((error) => ({ diagnosticUnavailable: error.message })),
    )
  if (app)
    console.error(
      await app
        .windows()[0]
        ?.evaluate(() => document.querySelector('.ProseMirror')?.editor.getJSON())
        .catch((error) => ({ diagnosticUnavailable: error.message })),
    )
  if (app)
    await app
      .windows()[0]
      ?.screenshot({ path: path.join(root, 'failure.png') })
      .catch(() => {})
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
