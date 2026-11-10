import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'melo-mermaid-e2e-')))
const workspace = path.join(root, 'workspace')
const profile = path.join(root, 'profile')
const file = path.join(workspace, 'diagrams.md')
const flow = 'flowchart LR\n  A[开始] --> B[完成]'
const sequence = 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi'
const bad = 'flowchart LR\n A[unfinished'
const markdown = `# Diagrams\n\n\`\`\`mermaid\n${flow}\n\`\`\`\n\n\`\`\`Mermaid\n${sequence}\n\`\`\`\n\n\`\`\`mermaid\n${bad}\n\`\`\`\n\nAfter.\n`
let app
let page
const errors = []
try {
  fs.mkdirSync(workspace)
  fs.mkdirSync(profile)
  fs.writeFileSync(file, markdown)
  fs.mkdirSync(path.join(workspace, '.assets'))
  fs.writeFileSync(
    path.join(workspace, '.assets', 'badge.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="steelblue"/></svg>',
  )
  fs.writeFileSync(
    path.join(workspace, 'photos.md'),
    '# Photos\n\n![Photo caption](.assets/photo.png "Photo title")\n\nText ![Badge](.assets/badge.svg) after badge.\n\n![Missing](.assets/missing.png)\n',
  )
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ lastDirectory: workspace }),
  )
  app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot],
    cwd: projectRoot,
    env: { ...process.env, MELO_USER_DATA: profile, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  await app.evaluate(({ shell, dialog, clipboard }, outputRoot) => {
    globalThis.mermaidCopies = []
    clipboard.write = (content) => {
      globalThis.mermaidCopies.push({
        image: content.image?.getSize(),
        png: content.image?.toDataURL(),
        html: content.html,
        text: content.text,
      })
    }
    globalThis.mediaOpenedURLs = []
    shell.openExternal = async (url) => {
      globalThis.mediaOpenedURLs.push(url)
    }
    shell.openPath = async () => ''
    dialog.showSaveDialog = async (_window, options) => ({
      canceled: false,
      filePath:
        outputRoot + '/' + (options.defaultPath.endsWith('.pdf') ? 'export.pdf' : 'export.html'),
    })
  }, root)
  const png = await app.evaluate(({ nativeImage }) => {
    const width = 640,
      height = 320
    const pixels = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4
        pixels[offset] = Math.round(80 + (x / width) * 120)
        pixels[offset + 1] = Math.round(60 + (y / height) * 140)
        pixels[offset + 2] = 160
        pixels[offset + 3] = 255
      }
    return nativeImage.createFromBitmap(pixels, { width, height }).toDataURL()
  })
  fs.writeFileSync(
    path.join(workspace, '.assets', 'photo.png'),
    Buffer.from(png.split(',')[1], 'base64'),
  )
  page = await app.firstWindow()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.mermaidCopiedCode = text
        },
      },
    })
  })
  page.on('pageerror', (error) => errors.push(error.stack))
  await page
    .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'diagrams' }) })
    .first()
    .click()
  const blocks = page.locator('pre.has-mermaid')
  await waitUntil('both valid diagrams render', () =>
    page.evaluate(
      () =>
        Array.from(document.querySelectorAll('pre.has-mermaid img')).filter(
          (image) => !image.hidden && image.naturalWidth > 0,
        ).length === 2,
    ),
  )
  await blocks.nth(2).locator('.has-error').waitFor()
  assert.equal(
    await page.locator('.image-viewport-canvas svg').count(),
    0,
    'SVG markup must remain in image contexts',
  )
  const prose = page.locator('.ProseMirror')
  const firstCanvas = blocks.first().locator('.image-viewport-canvas')
  const firstImage = firstCanvas.locator('img')
  const originalMarkdown = await prose.evaluate((element) => element.editor.getMarkdown())
  const initialTransform = await firstImage.evaluate((image) => image.style.transform)
  const copyDiagram = blocks.first().getByRole('button', { name: 'Copy image', exact: true })
  await waitUntil('rendered diagrams can be copied as images', () => copyDiagram.isEnabled())
  await page.mouse.move(0, 0)
  await waitUntil('diagram actions stay hidden during reading', () =>
    copyDiagram.evaluate((button) => getComputedStyle(button).opacity === '0'),
  )
  await page.screenshot({ path: '/tmp/melo-mermaid-reading.png' })
  assert(await blocks.nth(2).getByRole('button', { name: 'Copy image', exact: true }).isDisabled())
  const copyWidth = (await copyDiagram.boundingBox()).width
  await firstCanvas.hover()
  await waitUntil('hover reveals diagram actions', () =>
    copyDiagram.evaluate((button) => getComputedStyle(button).opacity === '1'),
  )
  await copyDiagram.click()
  const originalCopy = await app.evaluate(() => globalThis.mermaidCopies.at(-1))
  assert.deepEqual(
    originalCopy.image,
    await firstImage.evaluate((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
  )
  assert(originalCopy.html.includes('data:image/png;base64,'))
  await firstCanvas.hover()
  await blocks.first().getByRole('button', { name: 'Zoom in (+)', exact: true }).click()
  assert.equal(await blocks.first().locator('.image-viewport-percentage').textContent(), '125%')
  const zoomedTransform = await firstImage.evaluate((image) => image.style.transform)
  const bounds = await firstCanvas.boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 20, {
    steps: 5,
  })
  await page.mouse.up()
  assert.notEqual(await firstImage.evaluate((image) => image.style.transform), zoomedTransform)
  await copyDiagram.click()
  assert.equal(
    await app.evaluate(() => globalThis.mermaidCopies.at(-1).png),
    originalCopy.png,
    'copying a zoomed/panned diagram must still copy its complete original image',
  )
  assert.equal(await blocks.first().locator('.cb-copy').isVisible(), false)
  const beforeWheel = await firstImage.evaluate((image) => image.style.transform)
  const plainWheel = await firstCanvas.evaluate((canvas) => {
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })
    canvas.dispatchEvent(event)
    return event.defaultPrevented
  })
  assert.equal(plainWheel, false, 'ordinary scrolling must remain available to the article')
  assert.equal(await firstImage.evaluate((image) => image.style.transform), beforeWheel)
  assert.equal(
    await firstCanvas.evaluate((canvas) => {
      const rect = canvas.getBoundingClientRect()
      const event = new WheelEvent('wheel', {
        deltaY: -100,
        ctrlKey: true,
        clientX: rect.x + 80,
        clientY: rect.y + 60,
        bubbles: true,
        cancelable: true,
      })
      canvas.dispatchEvent(event)
      return event.defaultPrevented
    }),
    true,
  )
  assert.notEqual(await firstImage.evaluate((image) => image.style.transform), beforeWheel)
  await blocks.first().getByRole('button', { name: 'Reset view (0)', exact: true }).click()
  assert.equal(await firstImage.evaluate((image) => image.style.transform), initialTransform)
  await firstCanvas.focus()
  await page.keyboard.press('ArrowRight')
  assert.notEqual(await firstImage.evaluate((image) => image.style.transform), initialTransform)
  await page.keyboard.press('0')
  assert.equal(await firstImage.evaluate((image) => image.style.transform), initialTransform)
  await page.screenshot({ path: '/tmp/melo-mermaid-navigation.png' })
  await blocks.first().getByRole('button', { name: 'Expand view', exact: true }).click()
  const lightbox = page.locator('.ilb-scrim')
  await lightbox.waitFor()
  await waitUntil('expanded diagram loads', () =>
    lightbox
      .locator('img')
      .evaluate((image) => image.naturalWidth > 0 && image.style.visibility === 'visible'),
  )
  assert.notEqual(
    await lightbox.locator('img').evaluate((image) => image.style.backgroundColor),
    '',
  )
  const inlineZoomBeforeExpand = await blocks
    .first()
    .locator('.image-viewport-percentage')
    .textContent()
  const fullscreenZoom = await lightbox.locator('.ilb-pct').textContent()
  await page.keyboard.press('+')
  await waitUntil(
    'expanded viewer owns keyboard zoom',
    async () => (await lightbox.locator('.ilb-pct').textContent()) !== fullscreenZoom,
  )
  assert.equal(
    await blocks.first().locator('.image-viewport-percentage').textContent(),
    inlineZoomBeforeExpand,
  )
  await page.keyboard.press('Escape')
  await lightbox.waitFor({ state: 'detached' })
  assert(
    await firstCanvas.evaluate((canvas) => document.activeElement === canvas),
    'closing the viewer restores focus to the inline diagram',
  )
  assert.equal(
    await prose.evaluate((element) => element.editor.getMarkdown()),
    originalMarkdown,
    'view operations must not edit the document',
  )
  await firstCanvas.click()
  assert.equal(
    await prose.evaluate((element) => element.editor.state.selection.node?.type.name),
    'codeBlock',
  )
  await page.evaluate(() => {
    document.addEventListener(
      'copy',
      (event) => {
        window.mermaidKeyboardCopy = {
          html: event.clipboardData.getData('text/html'),
          text: event.clipboardData.getData('text/plain'),
          handled: event.defaultPrevented,
        }
        // Inspect the editor's payload without writing to the user's clipboard.
        event.clipboardData.clearData()
        event.preventDefault()
      },
      { once: true },
    )
  })
  await page.keyboard.press(`${modifier}+C`)
  const keyboardCopy = await page.evaluate(() => window.mermaidKeyboardCopy)
  assert(
    keyboardCopy?.handled && keyboardCopy.html.includes('<pre') && keyboardCopy.text.includes(flow),
    'keyboard copy from a selected Mermaid block must use the editor clipboard pipeline: ' +
      JSON.stringify(keyboardCopy),
  )
  const stored = () => prose.evaluate((element) => element.editor.getMarkdown())
  assert((await stored()).includes(flow))
  await blocks.first().getByRole('button', { name: 'Edit source', exact: true }).click()
  await blocks.first().locator('code').waitFor({ state: 'visible' })
  const copyCode = blocks.first().getByRole('button', { name: 'Copy code', exact: true })
  assert.equal((await copyCode.boundingBox()).width, copyWidth, 'copy modes retain button width')
  await copyCode.click()
  assert.equal(await page.evaluate(() => window.mermaidCopiedCode), flow)
  await page.screenshot({ path: '/tmp/melo-mermaid-copy-code.png' })
  await blocks.first().locator('code').click()
  await prose.evaluate((element) => {
    const editor = element.editor
    let pos
    editor.state.doc.descendants((node, position) => {
      if (pos === undefined && node.type.name === 'codeBlock') pos = position
    })
    const node = editor.state.doc.nodeAt(pos)
    editor.commands.setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 })
  })
  await page.keyboard.press('Backspace')
  await page.keyboard.type('flowchart LR')
  await page.keyboard.press('Enter')
  await page.keyboard.type('  A[Changed] --> B[Done]')
  await blocks.first().getByRole('button', { name: 'Preview diagram', exact: true }).click()
  await waitUntil('edited source renders', () =>
    blocks
      .first()
      .locator('img')
      .evaluate(
        (image) =>
          !image.hidden &&
          image.naturalWidth > 0 &&
          decodeURIComponent(image.src).includes('Changed'),
      ),
  )
  await page.keyboard.press(`${modifier}+Z`)
  await waitUntil('source edit is undoable', async () => (await stored()).includes(flow))
  await page.keyboard.press(`${modifier}+Shift+Z`)
  await waitUntil('source edit is redoable', async () => (await stored()).includes('A[Changed]'))
  if (
    await blocks.first().getByRole('button', { name: 'Preview diagram', exact: true }).isVisible()
  )
    await blocks.first().getByRole('button', { name: 'Preview diagram', exact: true }).click()
  await waitUntil('diagram is visible after redo', () =>
    blocks
      .first()
      .locator('img')
      .evaluate((image) => !image.hidden && image.naturalWidth > 0),
  )
  const lightImage = await blocks.first().locator('img').getAttribute('src')
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await waitUntil(
    'theme change re-renders diagram',
    async () => (await blocks.first().locator('img').getAttribute('src')) !== lightImage,
  )
  await page.screenshot({ path: '/tmp/melo-mermaid-dark.png' })
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  await waitUntil(
    'light diagram settles',
    async () =>
      (await blocks.first().locator('img').getAttribute('src')) !== lightImage &&
      (await blocks
        .first()
        .locator('img')
        .evaluate((image) => !image.hidden)),
  )
  await page.screenshot({ path: '/tmp/melo-mermaid-light.png' })
  await page.keyboard.press(`${modifier}+S`)
  await waitUntil('save persists Mermaid source', () =>
    fs.readFileSync(file, 'utf8').includes('A[Changed]'),
  )
  const saved = fs.readFileSync(file, 'utf8')
  assert(saved.includes('```mermaid'))
  assert(saved.includes(bad))
  assert(!saved.includes('data:image') && !saved.includes('mermaid-preview'))
  for (const format of ['html', 'pdf']) {
    await page.evaluate(
      (format) => window.dispatchEvent(new CustomEvent('melo:export', { detail: { format } })),
      format,
    )
    await waitUntil(format + ' export', () => fs.existsSync(path.join(root, 'export.' + format)))
  }
  const html = fs.readFileSync(path.join(root, 'export.html'), 'utf8')
  assert.equal((html.match(/class="mermaid-diagram"/g) ?? []).length, 2)
  assert(html.includes('data:image/svg+xml'))
  assert(html.includes('unfinished'), 'invalid diagrams must retain their source in exports')
  assert(fs.readFileSync(path.join(root, 'export.pdf')).subarray(0, 4).equals(Buffer.from('%PDF')))
  await blocks.nth(2).hover()
  await blocks.nth(2).getByRole('button', { name: 'Edit source', exact: true }).click()
  await prose.evaluate((element) => {
    const editor = element.editor
    const positions = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock') positions.push(pos)
    })
    const pos = positions[2]
    editor.commands.setTextSelection({
      from: pos + 1,
      to: pos + editor.state.doc.nodeAt(pos).nodeSize - 1,
    })
  })
  await page.keyboard.press('Backspace')
  await page.keyboard.type('flowchart LR')
  await page.keyboard.press('Enter')
  await page.keyboard.type(' X --> Y')
  await blocks.nth(2).getByRole('button', { name: 'Preview diagram', exact: true }).click()
  await waitUntil('invalid source can recover after editing', () =>
    blocks
      .nth(2)
      .locator('img')
      .evaluate((image) => !image.hidden && image.naturalWidth > 0),
  )
  await prose.evaluate((element) => element.editor.setEditable(false))
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.mermaid-toggle')).every((button) => button.disabled),
  )
  const readonlyZoom = await blocks.first().locator('.image-viewport-percentage').textContent()
  await firstCanvas.focus()
  await blocks.first().getByRole('button', { name: 'Zoom in (+)', exact: true }).click()
  assert.notEqual(
    await blocks.first().locator('.image-viewport-percentage').textContent(),
    readonlyZoom,
    'read-only diagrams still allow view navigation',
  )
  await prose.evaluate((element) => element.editor.setEditable(true))
  await prose.locator(':scope > p').last().click()
  await prose.evaluate((element) => {
    const editor = element.editor
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.view.focus()
  })
  await page.keyboard.press('Enter')
  await page.keyboard.type('/mermaid')
  await page.locator('.slash-item', { hasText: 'Mermaid diagram' }).click()
  await waitUntil('slash command inserts a Mermaid block', async () => (await blocks.count()) === 4)
  const inserted = page.locator('pre.code-block').last()
  assert((await inserted.locator('code').textContent()).includes('A[Start] --> B[Finish]'))
  await inserted.locator('.cb-lang-btn').click()
  await page.locator('.lang-picker-input').fill('plaintext')
  await page.locator('.lang-picker-item', { hasText: /^plaintext$/ }).click()
  assert(!(await inserted.getAttribute('class')).includes('has-mermaid'))
  await inserted.locator('.cb-lang-btn').click()
  await page.locator('.lang-picker-input').fill('mermaid')
  await page.locator('.lang-picker-item', { hasText: /^mermaid$/ }).click()
  await inserted.locator('code').waitFor({ state: 'visible' })
  assert(
    (await inserted.getAttribute('class')).includes('mermaid-source'),
    'returning focus from the picker must not leave the caret in hidden code',
  )
  await page
    .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'photos' }) })
    .first()
    .click()
  const photo = prose.locator('.img-wrap.img-block', {
    has: page.locator('img[alt="Photo caption"]'),
  })
  const photoCanvas = photo.locator('.image-viewport-canvas')
  const photoImage = photoCanvas.locator('img')
  await waitUntil('ordinary photo supports inline viewing', () =>
    photoImage.evaluate((image) => !image.hidden && image.naturalWidth === 640),
  )
  assert.equal(await photo.locator('.img-alt').textContent(), 'Photo caption')
  const badge = prose.locator('.img-wrap:not(.img-block)')
  assert.equal(
    await badge.locator('.image-viewport').count(),
    0,
    'inline badges must keep flowing with text',
  )
  const beforePhotoView = await stored()
  const fittedPhoto = await photoImage.evaluate((image) => image.style.transform)
  const photoHeight = await photoCanvas.evaluate((canvas) => canvas.clientHeight)
  const photoControls = photo.locator('.image-viewport-controls')
  await page.mouse.move(0, 0)
  await waitUntil('photo controls stay hidden during reading', () =>
    photoControls.evaluate((element) => getComputedStyle(element).opacity === '0'),
  )
  await page.screenshot({ path: '/tmp/melo-inline-image-reading.png' })
  await photoCanvas.hover()
  await waitUntil('hover reveals photo controls', () =>
    photoControls.evaluate((element) => getComputedStyle(element).opacity === '1'),
  )
  await page.screenshot({ path: '/tmp/melo-inline-image-hover.png' })
  const controlBounds = await photoControls.boundingBox()
  const canvasBounds = await photoCanvas.boundingBox()
  assert(
    controlBounds.y >= canvasBounds.y &&
      controlBounds.y + controlBounds.height <= canvasBounds.y + canvasBounds.height,
    'controls must overlay the canvas instead of reserving a footer row',
  )
  await photoCanvas.focus()
  await page.mouse.move(0, 0)
  assert.equal(
    await photoControls.evaluate((element) => getComputedStyle(element).pointerEvents),
    'auto',
    'keyboard focus must keep the controls available without hovering',
  )
  await photo.getByRole('button', { name: 'Zoom in (+)', exact: true }).click()
  assert.notEqual(await photoImage.evaluate((image) => image.style.transform), fittedPhoto)
  assert.equal(
    await photoCanvas.evaluate((canvas) => canvas.clientHeight),
    photoHeight,
    'zooming must not shift the article layout',
  )
  const photoBounds = await photoCanvas.boundingBox()
  await page.mouse.move(
    photoBounds.x + photoBounds.width / 2,
    photoBounds.y + photoBounds.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    photoBounds.x + photoBounds.width / 2 + 50,
    photoBounds.y + photoBounds.height / 2 + 30,
    { steps: 5 },
  )
  await page.mouse.up()
  await page.locator('.img-pop').waitFor()
  assert.equal(
    await photo.evaluate((element) => getComputedStyle(element).outlineStyle),
    'solid',
    'image selection must retain the outer block frame',
  )
  assert(
    await photo.locator('.image-viewport-photo').evaluate((element) => {
      const width = element.getBoundingClientRect().width
      const outerWidth = element.parentElement.getBoundingClientRect().width
      return getComputedStyle(element).borderTopWidth === '0px' && Math.abs(width - outerWidth) < 1
    }),
    'the viewport must fill the outer frame without a nested image border',
  )
  assert.equal(await stored(), beforePhotoView, 'panning and zooming photos must preserve Markdown')
  await photo.getByRole('button', { name: 'Reset view (0)', exact: true }).click()
  assert.equal(await photoImage.evaluate((image) => image.style.transform), fittedPhoto)
  await page.screenshot({ path: '/tmp/melo-inline-image-viewport.png' })
  await prose.evaluate((element) => {
    const editor = element.editor
    let target
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.alt === 'Photo caption') target = pos
    })
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(target, undefined, {
        ...editor.state.doc.nodeAt(target).attrs,
        width: 160,
      }),
    )
  })
  await waitUntil('authored image dimensions remain effective', () =>
    photoImage.evaluate(
      (image) =>
        Math.abs(image.getBoundingClientRect().width - 160) < 1 &&
        Math.abs(image.getBoundingClientRect().height - 80) < 1,
    ),
  )
  await photoCanvas.click()
  await app.evaluate(({ clipboard }) => {
    globalThis.mediaCopied = null
    clipboard.write = (content) => {
      globalThis.mediaCopied = {
        html: content.html,
        text: content.text,
        image: content.image?.getSize(),
      }
    }
  })
  await page.keyboard.press(`${modifier}+C`)
  await waitUntil('copy uses the original full image', () =>
    app.evaluate(() => globalThis.mediaCopied?.image?.width === 640),
  )
  const copiedPhoto = await app.evaluate(() => globalThis.mediaCopied)
  assert.equal(copiedPhoto.image.height, 320)
  assert(!copiedPhoto.html.includes('image-viewport'), 'view controls must not enter copied HTML')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.mediaCopiedMarkdown = text
        },
      },
    })
  })
  await photoCanvas.focus()
  await waitUntil('Copy as Markdown menu becomes available', () =>
    app.evaluate(
      ({ Menu }) => Menu.getApplicationMenu().getMenuItemById('copy-as-markdown').enabled,
    ),
  )
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('#main'),
    )
    if (BrowserWindow.getFocusedWindow() === window)
      Menu.getApplicationMenu().getMenuItemById('copy-as-markdown').click()
    else window.webContents.send('on-copy-as-markdown')
  })
  await waitUntil('Copy as Markdown still works from the image viewport', () =>
    page.evaluate(() => window.mediaCopiedMarkdown?.includes('.assets/photo.png')),
  )
  await photoCanvas.click()
  await page.locator('.img-pop .lk-fields input').nth(1).fill('Updated photo caption')
  await page.locator('.img-pop .lk-apply').click()
  await waitUntil('image editing preserves the viewport', () =>
    prose.locator('.img-alt', { hasText: 'Updated photo caption' }).isVisible(),
  )
  const photoAfterEdit = prose.locator('.img-wrap.img-block', {
    has: page.locator('img[alt="Updated photo caption"]'),
  })
  assert.equal(await photoAfterEdit.locator('.image-viewport').count(), 1)
  await photoAfterEdit.locator('.image-viewport-canvas').hover()
  await photoAfterEdit.getByRole('button', { name: 'Expand view', exact: true }).click()
  await lightbox.waitFor()
  await page.keyboard.press('Escape')
  await lightbox.waitFor({ state: 'detached' })
  await prose.evaluate((element) => {
    const editor = element.editor
    let target
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.alt === 'Updated photo caption') target = pos
    })
    const node = editor.state.doc.nodeAt(target)
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(target, undefined, node.attrs, [
        editor.state.schema.marks.link.create({ href: 'https://example.com/photo' }),
      ]),
    )
    editor.setEditable(false)
  })
  const openedBeforeView = await app.evaluate(() => globalThis.mediaOpenedURLs.length)
  const readonlyPhotoZoom = await photoAfterEdit.locator('.image-viewport-percentage').textContent()
  await photoAfterEdit.locator('.image-viewport-canvas').hover()
  await photoAfterEdit.getByRole('button', { name: 'Zoom in (+)', exact: true }).click()
  assert.notEqual(
    await photoAfterEdit.locator('.image-viewport-percentage').textContent(),
    readonlyPhotoZoom,
  )
  assert.equal(
    await app.evaluate(() => globalThis.mediaOpenedURLs.length),
    openedBeforeView,
    'linked image controls must not activate the surrounding link',
  )
  await photoAfterEdit.locator('.image-viewport-canvas').click()
  assert.equal(
    await page.locator('.img-pop').count(),
    0,
    'read-only images must not expose editable fields',
  )
  await prose.evaluate((element) => element.editor.setEditable(true))
  const missing = prose.locator('.img-wrap.img-block', { has: page.locator('img[alt="Missing"]') })
  await missing.locator('.image-viewport-status').click()
  await page.locator('.img-pop').waitFor()
  await page.locator('.img-pop').getByTitle('Delete image', { exact: true }).click()
  assert.equal(await missing.count(), 0, 'broken image placeholders remain editable and removable')
  await prose.evaluate((element) => {
    const editor = element.editor
    let first
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.alt === 'Updated photo caption') first = pos
    })
    editor.commands.setNodeSelection(first)
  })
  const beforeButtonEnter = await stored()
  const beforeButtonZoom = await photoAfterEdit.locator('.image-viewport-percentage').textContent()
  await photoAfterEdit.getByRole('button', { name: 'Zoom in (+)', exact: true }).focus()
  await page.keyboard.press('Enter')
  assert.equal(
    await stored(),
    beforeButtonEnter,
    'Enter on a viewport button must not edit the note',
  )
  assert.notEqual(
    await photoAfterEdit.locator('.image-viewport-percentage').textContent(),
    beforeButtonZoom,
  )
  await prose.evaluate((element) => {
    const editor = element.editor
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'paragraph',
      content: [{ type: 'image', attrs: { src: '.assets/photo.png', alt: 'Second photo' } }],
    })
    let first
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.alt === 'Updated photo caption') first = pos
    })
    editor.commands.setNodeSelection(first)
  })
  const secondPhoto = prose.locator('.img-wrap.img-block', {
    has: page.locator('img[alt="Second photo"]'),
  })
  const secondCanvas = secondPhoto.locator('.image-viewport-canvas')
  await waitUntil('second photo is ready for keyboard navigation', () =>
    secondPhoto.locator('img').evaluate((image) => !image.hidden && image.naturalWidth > 0),
  )
  await photoAfterEdit.locator('.image-viewport-canvas').focus()
  for (let i = 0; i < 12; i++) {
    if (await secondCanvas.evaluate((canvas) => document.activeElement === canvas)) break
    await page.keyboard.press('Tab')
  }
  assert(await secondCanvas.evaluate((canvas) => document.activeElement === canvas))
  await page.keyboard.press('Backspace')
  assert.equal(await photoAfterEdit.count(), 1, 'deleting focused image B must not delete image A')
  assert.equal(await secondPhoto.count(), 0, 'Backspace must delete the focused image B')
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify(
      {
        ok: true,
        coverage: [
          'flowchart',
          'sequence',
          'case-insensitive language',
          'syntax error preserves source',
          'source editing',
          'undo/redo',
          'theme switch',
          'Markdown save',
          'HTML export',
          'PDF export',
          'syntax recovery',
          'read-only preview',
          'slash insertion',
          'language picker conversion',
          'inline zoom and drag pan',
          'modifier wheel zoom preserves article scrolling',
          'reset and keyboard navigation',
          'expanded viewer and Escape close',
          'view transforms preserve Markdown',
          'ordinary inline photo pan and zoom',
          'photo captions and inline badges',
          'full image copy and Copy as Markdown',
          'image editing and read-only view',
          'broken image removal',
          'authored image dimensions and linked image controls',
        ],
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(error)
  if (page) {
    await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {})
    const state = await page
      .locator('.ProseMirror')
      .evaluate((el) => ({
        doc: el.editor.getJSON(),
        html: el.innerHTML,
        selection: el.editor.state.selection.toJSON(),
      }))
      .catch(() => null)
    fs.writeFileSync(path.join(root, 'failure-state.json'), JSON.stringify(state, null, 2))
  }
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

async function waitUntil(label, check) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw Error(`${label} timed out`)
}
