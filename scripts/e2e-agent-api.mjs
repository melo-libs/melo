import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

// A local proxy answers an unresolvable host: success proves the Chromium
// session proxy was used. No real credentials, model calls or downloads.
const project = fileURLToPath(new URL('..', import.meta.url))
const packaged = process.argv.find((arg) => arg.startsWith('--app='))?.slice(6)
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'melo-api-transport-'))
const requests = []
const proxy = createServer((request, response) => {
  requests.push({
    url: request.url,
    auth: request.headers.authorization,
    key: request.headers['x-api-key'],
    cookie: request.headers.cookie,
  })
  const route = new URL(request.url, 'http://127.0.0.1').pathname
  if (packaged) {
    const authorized = request.headers['x-api-key'] === 'fixture-key'
    response.writeHead(authorized ? 200 : 401, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify(
        authorized
          ? {
              id: 'msg_fixture',
              type: 'message',
              role: 'assistant',
              model: 'melo-fixture',
              content: [{ type: 'text', text: 'OK' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            }
          : { error: { type: 'authentication_error', message: 'Invalid fixture key' } },
      ),
    )
    return
  }
  response.writeHead(route === '/unauthorized' ? 401 : route === '/redirect' ? 302 : 200, {
    'Content-Type': 'application/json',
    ...(route === '/redirect' ? { Location: 'http://api-fixture.invalid/redirect-target' } : {}),
  })
  response.end(JSON.stringify(route === '/unauthorized' ? { error: 'fixture-key' } : { data: [] }))
})
let app
async function closeApp() {
  if (!app) return
  const child = app.process()
  const exited =
    child.exitCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once('exit', resolve))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await exited
  app = undefined
}
async function checkPackagedConnection() {
  const profile = path.join(root, 'profile')
  const executablePath = path.join(path.resolve(packaged), 'Contents/MacOS/Melo')
  const launch = async () => {
    const env = { ...process.env, MELO_USER_DATA: profile }
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ executablePath, args: [], env, timeout: 30000 })
    // Use only a fixed public fixture key, without accessing the user's Keychain.
    await app.evaluate(({ safeStorage }) => {
      globalThis.fixtureEncryptions = 0
      safeStorage.isEncryptionAvailable = () => true
      safeStorage.encryptString = (value) => {
        assertFixture(value === 'fixture-key')
        globalThis.fixtureEncryptions++
        return Buffer.from(`fixture:${value}`)
      }
      safeStorage.decryptString = (value) => {
        assertFixture(value.toString() === 'fixture:fixture-key')
        return 'fixture-key'
      }
      function assertFixture(matches) {
        if (!matches) throw new Error('Unexpected fixture credential')
      }
    })
    const page = await app.firstWindow()
    await page.waitForFunction(() => !!window.api)
    return page
  }
  let page = await launch()
  const invoke = (command) =>
    page.evaluate((input) => window.api.invoke('agent-command', input), command)
  const configuration = {
    action: 'configure',
    provider: 'claude',
    access: 'api',
    apiService: 'custom',
    baseUrl: `http://127.0.0.1:${proxy.address().port}`,
    model: 'melo-fixture',
    apiKey: 'fixture-key',
  }
  const saved = await invoke(configuration)
  assert.equal(saved.success, true)
  assert.equal(saved.data.setup.configuration.apiVerified, true)
  const test = { action: 'test-connection', provider: 'claude' }
  assert.equal((await invoke(test)).success, true)
  const rejected = await invoke({ ...configuration, apiKey: 'invalid-fixture-key' })
  assert.equal(rejected.success, false)
  assert.equal(rejected.error, 'AGENT_API_AUTH_FAILED')
  assert.deepEqual(rejected.data.setup.configuration, saved.data.setup.configuration)
  assert.equal((await invoke(test)).success, true)
  assert.equal(requests.at(-1).key, 'fixture-key')
  assert.equal(await app.evaluate(() => globalThis.fixtureEncryptions), 1)
  await closeApp()
  page = await launch()
  const restored = await invoke({ action: 'setup', provider: 'claude' })
  assert.deepEqual(
    restored.data.setup.configuration,
    JSON.parse(JSON.stringify(saved.data.setup.configuration)),
  )
  assert.equal((await invoke(test)).success, true)
  assert.equal(await app.evaluate(() => globalThis.fixtureEncryptions), 0)
  console.log(
    'Passed: packaged API verification, read-only testing, rejected replacement rollback and saved connection after restart.',
  )
}
try {
  if (packaged) {
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    await checkPackagedConnection()
  } else {
    await build({
      configFile: false,
      logLevel: 'error',
      build: {
        outDir: root,
        emptyOutDir: false,
        minify: false,
        lib: {
          entry: path.join(project, 'src/main/agent/runtime/apiTransport.ts'),
          formats: ['cjs'],
          fileName: () => 'transport.cjs',
        },
        rollupOptions: { external: ['electron'] },
      },
    })
    const entry = path.join(root, 'main.cjs')
    await fs.writeFile(
      entry,
      `const { app } = require('electron');\napp.setPath('userData', ${JSON.stringify(path.join(root, 'profile'))});\nglobalThis.apiTransport = require('./transport.cjs');\napp.whenReady();\n`,
    )
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ executablePath: electronPath, args: [entry], env })
    const result = await app.evaluate(async ({ app, session }, port) => {
      await app.whenReady()
      const { requestAgentApi } = globalThis.apiTransport
      await session.defaultSession.setProxy({ proxyRules: `http://127.0.0.1:${port}` })
      await session.defaultSession.cookies.set({
        url: 'http://api-fixture.invalid',
        name: 'unrelated',
        value: 'cookie',
      })
      const call = async (route) => {
        try {
          return await requestAgentApi(`http://api-fixture.invalid/${route}`, {
            headers: { Authorization: 'Bearer fixture-key' },
          })
        } catch (error) {
          return error.message
        }
      }
      return {
        catalog: await call('models'),
        unauthorized: await call('unauthorized'),
        redirect: await call('redirect'),
      }
    }, proxy.address().port)
    assert.deepEqual(result, {
      catalog: JSON.stringify({ data: [] }),
      unauthorized: 'AGENT_API_AUTH_FAILED',
      redirect: 'AGENT_API_NETWORK_ERROR',
    })
    assert.equal(requests.length, 3, 'Authenticated redirects must never be followed')
    for (const request of requests) {
      assert.equal(request.auth, 'Bearer fixture-key')
      assert.equal(request.cookie, undefined, 'API requests must not use renderer cookies')
    }
    console.log(
      'Passed: Chromium proxy routing, explicit API auth, cookie isolation and redirect rejection.',
    )
  }
} finally {
  await closeApp()
  proxy.closeAllConnections()
  await new Promise((resolve) => proxy.close(resolve))
  await fs.rm(root, { recursive: true, force: true })
}
