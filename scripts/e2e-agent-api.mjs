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
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'melo-api-transport-'))
const requests = []
const proxy = createServer((request, response) => {
  requests.push({
    url: request.url,
    auth: request.headers.authorization,
    cookie: request.headers.cookie,
  })
  const route = new URL(request.url).pathname
  response.writeHead(route === '/unauthorized' ? 401 : route === '/redirect' ? 302 : 200, {
    'Content-Type': 'application/json',
    ...(route === '/redirect' ? { Location: 'http://api-fixture.invalid/redirect-target' } : {}),
  })
  response.end(JSON.stringify(route === '/unauthorized' ? { error: 'fixture-key' } : { data: [] }))
})
let app
try {
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
} finally {
  await app?.close()
  proxy.closeAllConnections()
  await new Promise((resolve) => proxy.close(resolve))
  await fs.rm(root, { recursive: true, force: true })
}
