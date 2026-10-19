import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arch = process.argv[2]
if (arch !== 'arm64' && arch !== 'x64') {
  throw new Error('Usage: node scripts/e2e-packaged-startup.mjs <arm64|x64> [app path]')
}

const appPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(projectRoot, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', 'Melo.app')
const executablePath = path.join(appPath, 'Contents', 'MacOS', 'Melo')
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-packaged-startup-'))
const profile = path.join(testRoot, 'profile')
const logs = []
let app

try {
  fs.mkdirSync(profile)
  app = await electron.launch({
    executablePath,
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
  page.on('pageerror', (error) => logs.push(`[renderer:pageerror] ${error.stack ?? error}\n`))
  await page.locator('.ws-opener[data-step="welcome"]').waitFor({ timeout: 30000 })
  await page.locator('.ob-welcome').getByRole('heading', { level: 1 }).waitFor()
  assert(await page.locator('.ob-continue').isVisible(), 'the welcome action must be visible')
  assert(await page.locator('.ob-continue').isEnabled(), 'the welcome action must be enabled')
  assert.equal(await app.evaluate(({ app: electronApp }) => electronApp.getVersion()), '2.0.0')
  assert.equal(app.windows().length, 1)
  assert(!/renderer:pageerror/.test(logs.join('')))
  console.log(JSON.stringify({ ok: true, arch, appPath }))
} catch (error) {
  console.error(error)
  if (logs.length) console.error('\n--- Packaged Electron logs ---\n' + logs.join(''))
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
