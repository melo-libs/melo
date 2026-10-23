import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'melo-onboarding-e2e-')))
const profile = path.join(testRoot, 'profile')
const workspace = path.join(testRoot, 'new-notes')
const screenshotDir = process.env.MELO_E2E_ONBOARDING_SCREENSHOTS
const logs = []
const requests = []
const features = ['collect', 'organize', 'distill', 'express', 'files']
let app

async function waitUntil(label, check, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${label} timed out`)
}

async function run() {
  fs.mkdirSync(profile)
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ language: 'en', settings: { theme: 'light' } }),
  )
  if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true })
  app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot],
    cwd: projectRoot,
    env: { ...process.env, MELO_USER_DATA: profile, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    timeout: 30000,
  })
  app.process().stderr?.on('data', (chunk) => logs.push(String(chunk)))
  const page = await app.firstWindow({ timeout: 30000 })
  page.on('pageerror', (error) => logs.push(`[pageerror] ${error.stack ?? error}`))
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url())
  })
  const opener = page.locator('.ws-opener')
  const next = page.locator('.ob-continue')
  const expectStep = (step) =>
    page.locator(`.ws-opener[data-step="${step}"]`).waitFor({ state: 'visible', timeout: 12000 })
  const screenshot = async (name) => {
    if (screenshotDir)
      await page.screenshot({
        path: path.join(screenshotDir, `${name}.png`),
        animations: 'disabled',
      })
  }
  const navigationGeometry = () =>
    page.locator('.ob-navigation').evaluate((footer) => {
      const rect = (element) => {
        const { x, y, width, height } = element.getBoundingClientRect()
        return { x, y, width, height }
      }
      return {
        footer: rect(footer),
        pagination: rect(footer.querySelector('.ob-pagination-slot')),
        button: rect(footer.querySelector('.ob-continue')),
      }
    })
  const continueAt = async (anchor) => {
    // Measure the resting layout, not the button's brief pressed-state transform.
    await next.evaluate((button) =>
      Promise.all(button.getAnimations().map((motion) => motion.finished)),
    )
    assert.deepEqual(await navigationGeometry(), anchor, 'navigation must stay in the same place')
    const mainBottom = await page
      .locator('.ob-main')
      .evaluate((element) => element.getBoundingClientRect().bottom)
    assert(mainBottom <= anchor.footer.y, 'navigation must not cover content')
    const viewportHeight = await page.evaluate(() => innerHeight)
    assert(anchor.footer.y + anchor.footer.height <= viewportHeight)
    if (viewportHeight > 740) {
      assert(
        anchor.button.y + anchor.button.height <= viewportHeight - 64,
        'desktop navigation needs breathing room below it',
      )
    }
    await page.mouse.click(
      anchor.button.x + anchor.button.width / 2,
      anchor.button.y + anchor.button.height / 2,
    )
  }
  const expectEditorFits = async () => {
    await page.evaluate(() => document.fonts.ready)
    const overflow = await page.locator('.ob-editor-document').evaluate((editor) => {
      const bounds = editor.getBoundingClientRect()
      const outside = [
        ...editor.querySelectorAll(
          '.ob-editor-main h2, .ob-editor-lead, .katex-html, .ob-editor-table, .ob-editor-figure, .ob-editor-code, .ob-editor-checklist',
        ),
      ]
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.left < bounds.left || rect.right > bounds.right || rect.bottom > bounds.bottom
        })
        .map((element) => element.className)
      const code = editor.querySelector('.ob-editor-code pre')
      if (code.scrollWidth > code.clientWidth) outside.push('code text')
      const math = editor.querySelector('.katex-html').getBoundingClientRect()
      const equation = editor.querySelector('.ob-editor-equation').getBoundingClientRect()
      if (math.width > equation.width) outside.push('equation width')
      return outside
    })
    assert.deepEqual(overflow, [], 'the complete editor example must fit inside its document')
  }
  const expectFilesFit = async () => {
    assert.equal(await page.locator('.ob-files-item').count(), 6)
    const fits = await page.locator('.ob-files-art').evaluate((scene) => {
      const bounds = scene.getBoundingClientRect()
      return [...scene.querySelectorAll('.ob-file-tag')].every((tag) => {
        const rect = tag.getBoundingClientRect()
        return (
          rect.left >= bounds.left &&
          rect.right <= bounds.right &&
          rect.top >= bounds.top &&
          rect.bottom <= bounds.bottom
        )
      })
    })
    assert(fits, 'all six format labels must remain visible above the illustration fade')
    assert.equal(
      await page.locator('.ob-files-art input, .ob-files-art button, .ob-files-art a').count(),
      0,
    )
    assert.equal(await page.locator('.ob-replay-scene').count(), 0)
  }

  const language = page.getByRole('combobox', { name: '语言 / Language', exact: true })
  await expectStep('welcome')
  await page.evaluate(() => document.fonts.ready)
  assert.equal(await language.inputValue(), 'en')
  await language.focus()
  await language.selectOption('zh-CN')
  await page.getByRole('heading', { name: '你好，我是 Melo', exact: true }).waitFor()
  assert.equal(
    await language.evaluate((select) => document.activeElement === select),
    true,
    'changing language must preserve keyboard focus',
  )
  await expectStep('welcome')
  await screenshot('00-welcome-zh')
  await language.selectOption('en')
  await page.getByRole('heading', { name: 'Hello, I’m Melo', exact: true }).waitFor()
  await expectStep('welcome')
  await page.evaluate(() => document.fonts.ready)
  await screenshot('01-welcome-en')
  assert.equal(await page.locator('.ob-skip').count(), 0)
  await new Promise((resolve) => setTimeout(resolve, 8000))
  assert.equal(
    await opener.getAttribute('data-step'),
    'welcome',
    'the welcome page must not advance automatically',
  )
  const navigation = await navigationGeometry()
  await continueAt(navigation)
  await expectStep('collect')
  assert.deepEqual(await page.locator('.ob-source-hint > span:last-child').allTextContents(), [
    'Anthropic',
    'Substack',
    'Medium',
  ])
  assert.equal(await page.locator('.ob-article-figure img').count(), 1)
  assert.equal(await page.locator('.ob-art input, .ob-art button').count(), 0)
  const expectedShortcut = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'CtrlK',
  )
  assert.equal(await page.locator('.ob-clip-field kbd').textContent(), expectedShortcut)
  await waitUntil('bundled article images', () =>
    page
      .locator('.ob-article-figure img')
      .evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)),
  )
  assert.equal(await page.locator('.ob-demo-result, .ob-feature-label').count(), 0)
  await new Promise((resolve) => setTimeout(resolve, 8000))
  assert.equal(
    await opener.getAttribute('data-step'),
    'collect',
    'finishing an animation must not turn the page',
  )
  const headingTop = await page
    .locator('.ob-feature h1')
    .evaluate((title) => title.getBoundingClientRect().top)
  for (const feature of features) {
    await expectStep(feature)
    await page.evaluate(() => document.fonts.ready)
    const typography = await page.locator('.ob-feature h1').evaluate((title) => {
      const style = getComputedStyle(title)
      return {
        top: title.getBoundingClientRect().top,
        size: parseFloat(style.fontSize),
        weight: Number(style.fontWeight),
        alignHeadings: innerWidth > 900 && innerHeight > 740,
      }
    })
    assert(
      typography.size <= 32 && typography.weight <= 600,
      'headings should not overpower the artwork',
    )
    if (typography.alignHeadings)
      assert.equal(typography.top, headingTop, 'feature headings should align')
    const motionTarget = {
      collect: '.ob-captured',
      distill: '.ob-editor-lead mark',
      express: '.ob-chat-preview > div',
    }[feature]
    const motions = await page.locator('.ob-art').evaluate(
      (art, target) =>
        [...art.querySelectorAll('*')].flatMap((element) => {
          const style = getComputedStyle(element)
          if (style.animationName === 'none') return []
          return [
            {
              isTarget: element.matches(target),
              duration: parseFloat(style.animationDuration) * 1000,
              delay: style.animationDelay,
              iterations: style.animationIterationCount,
              easing: style.animationTimingFunction,
              opacity: style.opacity,
              clipPath: style.clipPath,
            },
          ]
        }),
      motionTarget ?? ':not(*)',
    )
    assert.equal(
      motions.length,
      feature === 'organize' || feature === 'files' ? 0 : 1,
      'one motion per scene at most',
    )
    for (const motion of motions) {
      assert(motion.isTarget)
      assert(motion.duration >= 400 && motion.duration <= 900, 'keep a natural single beat')
      assert.equal(motion.delay, '0s', 'the scene must not wait for a sequence')
      assert.equal(motion.iterations, '1')
      assert(!motion.easing.includes('steps'), 'no typewriter or stepped reveals')
      assert.equal(motion.opacity, '1', 'the outcome must stay readable')
      assert.equal(motion.clipPath, 'none', 'text must not be revealed by clipping')
    }
    if (feature === 'distill') {
      assert.equal(await page.locator('.ob-editor-equation .katex').count(), 1)
      assert.equal(await page.locator('.ob-editor-equation .katex-error').count(), 0)
      assert.equal(await page.locator('.ob-editor-table tbody tr').count(), 2)
      assert.equal(await page.locator('.ob-editor-figure svg').isVisible(), true)
      assert.equal(await page.locator('.ob-editor-code pre').isVisible(), true)
      assert.equal(await page.locator('.ob-editor-checklist li').count(), 1)
      assert.equal(await page.locator('.ob-reference, .ob-writing').count(), 0)
      await expectEditorFits()
    }
    if (feature === 'organize') {
      assert.equal(await page.locator('.ob-organize-art article').count(), 0)
      assert.equal(await page.locator('.ob-organize-directory').count(), 2)
      assert.equal(await page.locator('.ob-organize-view').count(), 2)
      assert.equal(await page.locator('.ob-organize-result').count(), 2)
      assert.equal(await page.locator('.ob-organize-result-title mark').textContent(), 'tool')
      assert.equal(await page.locator('.ob-organize-result-excerpt mark').textContent(), 'tool')
      assert.equal(await page.locator('.ob-organize-query kbd').textContent(), expectedShortcut)
      assert.equal(await page.locator('.ob-organize-search-heading').count(), 0)
      assert.equal(
        await page.locator('.ob-organize-upcoming').getAttribute('data-availability'),
        'planned',
      )
      assert.equal(
        await page.locator('.ob-organize-upcoming').textContent(),
        'AI-powered organization is on the way.',
      )
      assert.equal(
        await page
          .locator('.ob-organize-art')
          .evaluate((element) => element.getAnimations({ subtree: true }).length),
        0,
      )
      for (const capability of ['folders', 'smart', 'search', 'ai']) {
        assert.equal(await page.locator(`[data-capability="${capability}"]`).isVisible(), true)
      }
      assert.equal(await page.locator('.ob-replay-scene').count(), 0)
      await expectStep('organize')
    }
    if (feature === 'files') await expectFilesFit()
    await screenshot(`02-${feature}-en`)
    await continueAt(navigation)
  }
  await expectStep('start')
  assert(!fs.existsSync(workspace), 'the demo must not create notes or folders')
  await page.reload()
  await expectStep('start')
  await page.getByRole('button', { name: 'Replay the introduction', exact: true }).click()
  await expectStep('welcome')
  await next.click()
  await expectStep('collect')
  const artwork = await page.locator('.ob-art').elementHandle()
  await page.getByRole('button', { name: 'Replay this step', exact: true }).click()
  assert.equal(
    await artwork.evaluate((element) => element.isConnected),
    false,
    'replaying should restart only the scene',
  )
  await expectStep('collect')
  await page.keyboard.press('ArrowRight')
  await expectStep('organize')
  await page.keyboard.press('ArrowLeft')
  await expectStep('collect')
  await page.keyboard.press('Escape')
  await expectStep('collect')
  for (let index = 0; index < features.length; index += 1) await next.click()
  await expectStep('start')

  await language.selectOption('zh-CN')
  await page.getByRole('button', { name: '再看一遍介绍', exact: true }).waitFor()
  await page.reload()
  await expectStep('start')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.locator('.ws-opener[data-reduced-motion="true"]').waitFor()
  await page.getByRole('button', { name: '再看一遍介绍', exact: true }).click()
  await expectStep('welcome')
  await screenshot('03-welcome-zh')
  const chineseNavigation = await navigationGeometry()
  await continueAt(chineseNavigation)
  await expectStep('collect')
  assert.deepEqual(await page.locator('.ob-source-hint > span:last-child').allTextContents(), [
    'Anthropic',
    '微信公众号',
    '知乎',
  ])
  for (const feature of features) {
    await expectStep(feature)
    const animatedTarget = {
      collect: '.ob-captured',
      organize: '.ob-organize-search',
      distill: '.ob-editor-lead mark',
      express: '.ob-chat-preview > div',
      files: '.ob-files-stack',
    }[feature]
    assert.equal(
      await page
        .locator(animatedTarget)
        .evaluate((element) => getComputedStyle(element).animationName),
      'none',
    )
    if (feature === 'distill') await expectEditorFits()
    if (feature === 'files') await expectFilesFit()
    await screenshot(`04-${feature}-zh`)
    await continueAt(chineseNavigation)
  }
  await expectStep('start')
  await screenshot('05-start-zh')
  await page.evaluate(async () => {
    await window.api.invoke(window.api.channels.InvokeSetSettings, { patch: { theme: 'dark' } })
  })
  await waitUntil('dark theme', () =>
    page.evaluate(() => document.documentElement.dataset.theme === 'dark'),
  )
  await screenshot('06-dark-zh')
  await page.getByRole('button', { name: '再看一遍介绍', exact: true }).click()
  await next.click()
  await page.locator('.ob-page-dot').last().click()
  await expectStep('files')
  await expectFilesFit()
  await screenshot('06-files-dark-zh')
  await next.click()
  await expectStep('start')
  await page.evaluate(async () => {
    await window.api.invoke(window.api.channels.InvokeSetSettings, { patch: { theme: 'light' } })
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600))
  await waitUntil('minimum window size', () => page.evaluate(() => window.innerWidth === 800))
  await screenshot('07-compact-zh')
  await page.getByRole('button', { name: '再看一遍介绍', exact: true }).click()
  await next.click()
  await page.locator('.ob-page-dot').nth(2).click()
  await expectStep('distill')
  await expectEditorFits()
  await screenshot('07-compact-editor-zh')
  await next.click()
  await next.click()
  await expectStep('files')
  await expectFilesFit()
  await screenshot('07-compact-files-zh')
  await next.click()
  await expectStep('start')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25),
  )
  await waitUntil('zoomed viewport', () => page.evaluate(() => window.innerWidth === 640))
  await page.getByRole('button', { name: '再看一遍介绍', exact: true }).click()
  await expectStep('welcome')
  assert(
    await page
      .locator('.ob-main')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
    'welcome must not overflow horizontally under zoom',
  )
  const zoomedNavigation = await navigationGeometry()
  await continueAt(zoomedNavigation)
  for (const feature of features) {
    await expectStep(feature)
    assert(
      await page
        .locator('.ob-main')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
      'the demo must not overflow horizontally',
    )
    if (feature === 'distill') await expectEditorFits()
    if (feature === 'files') {
      await expectFilesFit()
      await screenshot('08-files-zoom-zh')
    }
    await page.locator('.ob-main').evaluate((main) => {
      main.scrollTop = main.scrollHeight
    })
    await continueAt(zoomedNavigation)
    assert.equal(await page.locator('.ob-main').evaluate((main) => main.scrollTop), 0)
  }
  await expectStep('start')
  assert.equal(await page.locator('.ob-choose-folder').count(), 1)
  assert.equal(await page.locator('.ob-entry-screen button').count(), 3)
  assert.equal(await page.locator('.ob-top .ob-replay').count(), 1)
  assert.equal(await page.locator('.ob-secondary-actions .ob-entry-link').count(), 2)
  assert.equal(await page.locator('.ob-entry, .ob-entry-list').count(), 0)
  assert(
    await page
      .locator('.ob-main')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
    'the folder action must fit under zoom',
  )
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1),
  )
  await waitUntil('reset zoom', () => page.evaluate(() => window.innerWidth === 800))

  await app.evaluate(({ dialog }) => {
    globalThis.__meloOnboardingPickerCalls = 0
    globalThis.__meloOnboardingPickerProperties = []
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.__meloOnboardingPickerCalls += 1
      globalThis.__meloOnboardingPickerProperties.push({
        kind: 'open',
        properties: options.properties,
      })
      return { canceled: true, filePaths: [] }
    }
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.__meloOnboardingPickerCalls += 1
      globalThis.__meloOnboardingPickerProperties.push({
        kind: 'save',
        properties: options.properties,
      })
      return { canceled: true }
    }
  })
  const entrySelectors = ['.ob-choose-folder', '.ob-create-folder', '.ob-open-file']
  for (const [index, selector] of entrySelectors.entries()) {
    await page.locator(selector).click()
    await waitUntil(
      'native picker cancellation',
      async () => (await app.evaluate(() => globalThis.__meloOnboardingPickerCalls)) === index + 1,
    )
    await waitUntil('entry action re-enabled', () => page.locator(selector).isEnabled())
    await expectStep('start')
  }
  assert.deepEqual(await app.evaluate(() => globalThis.__meloOnboardingPickerProperties), [
    { kind: 'open', properties: ['openDirectory', 'createDirectory'] },
    { kind: 'save', properties: ['createDirectory', 'showOverwriteConfirmation'] },
    { kind: 'open', properties: ['openFile'] },
  ])
  assert.deepEqual(requests, [], 'the demo must stay offline')
  assert(!logs.some((line) => line.includes('[pageerror]')), logs.join('\n'))

  // Simulate a folder created inside the native picker; adoption still initializes it normally.
  fs.mkdirSync(workspace)
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, workspace)
  await page.locator('.ob-choose-folder').click()
  await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 30000 })
  assert.equal(await opener.count(), 0)
  assert(fs.existsSync(workspace))
  assert(fs.existsSync(path.join(workspace, 'Inbox')))
  console.log(
    JSON.stringify({
      ok: true,
      languages: ['en', 'zh-CN'],
      automaticPageAdvance: false,
      reducedMotion: true,
      minimumWindow: [800, 600],
      screenshots: screenshotDir ?? null,
    }),
  )
}

try {
  await run()
} catch (error) {
  console.error(error)
  if (logs.length) console.error(logs.join('\n'))
  const page = app?.windows()[0]
  if (page) await page.screenshot({ path: path.join(testRoot, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
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
