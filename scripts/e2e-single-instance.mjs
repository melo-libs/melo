import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-single-instance-e2e-'))
const profile = path.join(testRoot, 'profile')
const workspace = path.join(testRoot, 'workspace')
const firstFile = path.join(testRoot, 'First.MARKDOWN')
const secondFile = path.join(testRoot, 'Second.md')
const thirdFile = path.join(testRoot, 'Third.markdown')
const logs = []
let app

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitUntil(label, check, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`${label} timed out`)
}

async function run() {
  fs.mkdirSync(profile)
  fs.mkdirSync(path.join(workspace, 'Inbox'), { recursive: true })
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ lastDirectory: workspace }, null, 2),
  )
  fs.writeFileSync(firstFile, '# First\n\nOpened before the renderer was ready.\n')
  fs.writeFileSync(secondFile, '# Second\n\nHanded off by the second launch.\n')
  fs.writeFileSync(thirdFile, '# Third\n\nQueued behind the second file.\n')

  const env = {
    ...process.env,
    MELO_USER_DATA: profile,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  }

  app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot, firstFile],
    cwd: projectRoot,
    env,
    timeout: 30000,
  })
  app.process().stdout?.on('data', (chunk) => logs.push(String(chunk)))
  app.process().stderr?.on('data', (chunk) => logs.push(String(chunk)))

  const page = await app.firstWindow({ timeout: 30000 })
  page.on('pageerror', (error) => logs.push(`[renderer:pageerror] ${error.stack ?? error}\n`))
  await waitUntil('cold-start .markdown file should open', async () =>
    (await page.locator('.ProseMirror').innerText()).includes(
      'Opened before the renderer was ready.',
    ),
  )
  assert.equal(await page.locator('.ed-tab[data-active="true"] .ed-tab-title').innerText(), 'First')
  assert.equal(
    await page.locator('.ed-tab').count(),
    2,
    'the first-use guide should restore before the requested file becomes active',
  )

  execFileSync(electronPath, [projectRoot, secondFile, thirdFile], {
    cwd: projectRoot,
    env,
    timeout: 10000,
    stdio: 'pipe',
  })

  await waitUntil('second launch should hand its files to the existing window', async () =>
    (await page.locator('.ProseMirror').innerText()).includes('Queued behind the second file.'),
  )
  assert.equal(await page.locator('.ed-tab').count(), 4)
  assert.equal((await app.windows()).length, 1)
  assert(!/Failed to read and send file|renderer:pageerror/i.test(logs.join('')))
}

try {
  await run()
  console.log(
    JSON.stringify({ ok: true, coldStartExtension: '.markdown', handedOff: ['.md', '.markdown'] }),
  )
} catch (error) {
  console.error(error)
  if (logs.length) console.error('\n--- Electron logs ---\n' + logs.join(''))
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
  if (process.exitCode) console.error(`Preserved E2E files for diagnosis: ${testRoot}`)
  else fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
