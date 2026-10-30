import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import electronPath from 'electron'
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'melo-agent-e2e-')))
const workspace = path.join(testRoot, 'workspace')
const profile = path.join(testRoot, 'profile')
const logs = []
const toolResults = []
const live = process.env.MELO_AGENT_LIVE === '1'
let app
let passed = false
const fixtureReply =
  '## Weekend plan\n\nStart with **one place**.\n\n- Book a train\n- Pack light\n\n```text\nSaturday: riverside market\n```\n\nSee [Weekend note](note.md) and [Packing list](packing.md). [Outside alias](external.md).' +
  Array.from(
    { length: 12 },
    (_, i) => `\n\n### Stop ${i + 1}\nLeave enough time to walk between places and take a break.`,
  ).join('')
const fixture = createServer((request, response) => {
  void respondToFixture(request, response).catch((error) => {
    logs.push(error.stack ?? error.message)
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
})
async function respondToFixture(request, response) {
  const url = new URL(request.url, 'http://localhost')
  if (!url.pathname.endsWith('/messages')) {
    response.writeHead(404)
    response.end()
    return
  }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  if (request.headers['x-api-key'] !== 'fixture-key') {
    response.writeHead(401)
    response.end(JSON.stringify({ error: { message: 'Invalid credentials' } }))
    return
  }
  if (body.model !== 'melo-fixture') {
    response.writeHead(400)
    response.end(JSON.stringify({ error: { message: 'Unknown model' } }))
    return
  }
  const message = {
    id: 'msg_fixture',
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 0 },
  }
  if (!body.stream) {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ ...message, content: [{ type: 'text', text: 'OK' }] }))
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const event = (type, data) =>
    response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  event('message_start', { message })
  const readTool = body.tools?.find((tool) => tool.name.includes('melo_read_document'))
  toolResults.push(
    ...body.messages.flatMap((message) =>
      Array.isArray(message.content)
        ? message.content.filter((block) => block.type === 'tool_result')
        : [],
    ),
  )
  const usedTool = body.messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((block) => block.type === 'tool_result'),
  )
  const promptText =
    body.messages
      .filter((message) => message.role === 'user')
      .flatMap((message) =>
        typeof message.content === 'string'
          ? [message.content]
          : message.content.filter((block) => block.type === 'text').map((block) => block.text),
      )
      .findLast((text) => text.includes('User request:')) ?? ''
  const currentRequest = promptText.split('User request:\n').at(-1) ?? ''
  const organizing =
    currentRequest.includes('organize_fixture') &&
    body.tools?.some((tool) => tool.name.includes('melo_create'))
  const editing =
    currentRequest.includes('edit_fixture') &&
    body.tools?.some((tool) => tool.name.includes('melo_edit_document'))
  const organizeActions = [
    ['melo_create', { path: 'Reference', directory: true }],
    ['melo_create', { path: 'Travel', directory: true }],
    ['melo_move', { source: 'packing.md', destination: 'Travel/packing.md' }],
  ]
  const organized = body.messages
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter(
      (block) => block.type === 'tool_result' && block.tool_use_id?.startsWith('organize_'),
    ).length
  const nextOrganize = organizing ? organizeActions[organized] : undefined
  if (nextOrganize) {
    const tool = body.tools.find((tool) => tool.name.includes(nextOrganize[0]))
    event('content_block_start', {
      index: 0,
      content_block: { type: 'tool_use', id: `organize_${organized}`, name: tool.name, input: {} },
    })
    event('content_block_delta', {
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(nextOrganize[1]) },
    })
    event('content_block_stop', { index: 0 })
    event('message_delta', {
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 10 },
    })
    event('message_stop', {})
    response.end()
    return
  }
  if (!organizing && readTool && !usedTool) {
    event('content_block_start', {
      index: 0,
      content_block: { type: 'tool_use', id: 'read_fixture', name: readTool.name, input: {} },
    })
    event('content_block_delta', {
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify({ path: 'note.md' }) },
    })
    event('content_block_stop', { index: 0 })
    event('message_delta', {
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 10 },
    })
    event('message_stop', {})
    response.end()
    return
  }
  const results = body.messages
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((block) => block.type === 'tool_result')
  if (editing && usedTool && !results.some((block) => block.tool_use_id === 'edit_fixture')) {
    const read = results.findLast((block) => block.tool_use_id === 'read_fixture')
    const snapshot = JSON.parse(
      Array.isArray(read.content)
        ? read.content.find((block) => block.type === 'text').text
        : read.content,
    )
    const tool = body.tools.find((tool) => tool.name.includes('melo_edit_document'))
    event('content_block_start', {
      index: 0,
      content_block: { type: 'tool_use', id: 'edit_fixture', name: tool.name, input: {} },
    })
    event('content_block_delta', {
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: JSON.stringify({
          path: 'note.md',
          expectedRevision: snapshot.revision,
          content: snapshot.content.replace('Saturday', 'Sunday'),
        }),
      },
    })
    event('content_block_stop', { index: 0 })
    event('message_delta', {
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 10 },
    })
    event('message_stop', {})
    response.end()
    return
  }
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', {
    index: 0,
    delta: {
      type: 'text_delta',
      text: editing
        ? 'Changed Saturday to Sunday.'
        : organizing
          ? 'The files are organized. Future articles can stay in Inbox until you decide where to keep them.'
          : fixtureReply,
    },
  })
  event('content_block_stop', { index: 0 })
  event('message_delta', {
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 20 },
  })
  event('message_stop', {})
  response.end()
}
async function waitUntil(label, check, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${label} timed out`)
}

function claudeAdapterPid() {
  const processes = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
    .filter(
      (row) =>
        row &&
        Number(row[2]) === app.process().pid &&
        row[3].includes('/claude-agent-acp/dist/index.js') &&
        !row[3].includes('--cli'),
    )
  assert.equal(processes.length, 1, 'the app must own exactly one warm Claude adapter')
  return Number(processes[0][1])
}

try {
  if (live || process.env.MELO_E2E_NATIVE_MODELS === '1') {
    const home = process.env.CODEX_HOME
    if (!home || !fs.realpathSync(home).startsWith(fs.realpathSync(os.tmpdir()) + path.sep))
      throw new Error(
        'Set CODEX_HOME to a dedicated temporary test account directory. Never copy developer credentials.',
      )
  }
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/anthropic`
  fs.mkdirSync(workspace)
  fs.mkdirSync(profile)
  const codexHome = path.join(testRoot, 'codex-home')
  const claudeHome = path.join(testRoot, 'claude-home')
  fs.mkdirSync(codexHome)
  fs.mkdirSync(claudeHome)
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ lastDirectory: workspace }),
  )
  const file = path.join(workspace, 'note.md')
  fs.writeFileSync(file, '# Weekend in Kyoto\n\nVisit the riverside market on Saturday.\n')
  fs.writeFileSync(
    path.join(testRoot, 'outside.md'),
    '# Outside workspace\n\nNever open from an Agent citation.',
  )
  fs.symlinkSync(path.join(testRoot, 'outside.md'), path.join(workspace, 'external.md'))
  fs.writeFileSync(
    path.join(workspace, 'packing.md'),
    '# Packing list\n\n- Walking shoes\n- Raincoat\n',
  )
  app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      MELO_USER_DATA: profile,
      CODEX_HOME:
        live || process.env.MELO_E2E_NATIVE_MODELS === '1' ? process.env.CODEX_HOME : codexHome,
      CLAUDE_CONFIG_DIR: claudeHome,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    timeout: 30000,
  })
  app.process().stderr?.on('data', (chunk) => logs.push(String(chunk)))
  const page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => logs.push(error.stack ?? error.message))
  await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 30000 })
  await page
    .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'note' }) })
    .first()
    .click()
  const editor = page.locator('.tiptap[contenteditable="true"]').first()
  await editor.waitFor({ state: 'visible' })
  await page.locator('.ed-ask-melo').click()
  await page.locator('.agent-window').waitFor({ state: 'visible' })
  await waitUntil('Claude setup', () => page.locator('.agent-settings').isVisible())
  await page.locator('.agent-auth-actions .ui-button').waitFor()
  await page.locator('.agent-access-mode .seg-opt').filter({ hasText: 'API Key' }).click()
  await page
    .locator('.agent-settings label')
    .filter({ hasText: 'API service' })
    .locator('.sel-btn')
    .click()
  await page.getByRole('menuitem', { name: 'Custom', exact: true }).click()
  await page.getByLabel('API base URL', { exact: true }).fill(fixtureUrl)
  await page.getByLabel('Model', { exact: true }).fill('invalid-model')
  await page.getByLabel('API key', { exact: true }).fill('fixture-key')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await page.locator('.agent-settings .agent-error').waitFor()
  assert((await page.locator('.agent-settings .agent-error').innerText()).includes('model ID'))
  assert(
    !(await page.locator('.agent-compose').isVisible()),
    'settings must not share the conversation composer',
  )
  await page.getByLabel('Model', { exact: true }).fill('melo-fixture')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await page.locator('.agent-test-success').waitFor()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.locator('.agent-settings').waitFor({ state: 'hidden' })
  assert(
    await page.locator('.agent-compose textarea').evaluate((el) => document.activeElement === el),
    'returning from settings must restore composer focus',
  )
  await page.getByRole('button', { name: 'Hide conversation', exact: true }).click()
  await editor.focus()
  await page.keyboard.press('Meta+a')
  await page.locator('.bubble-btn.bubble-ask').click()
  await page.locator('.bubble-selection').waitFor({ state: 'hidden' })
  await page.locator('.agent-body').dispatchEvent('scroll')
  assert.equal(
    await page.locator('.bubble-selection').count(),
    0,
    'AI panel scrolling must not revive the toolbar',
  )
  assert(
    await page.locator('.agent-context-strip').isVisible(),
    'the selected passage remains attached',
  )
  await editor.evaluate((element) => {
    element.focus()
    element.editor.commands.setTextSelection({ from: 1, to: 6 })
  })
  await page.locator('.bubble-turn').click()
  await page.locator('.bubble-format-dd').waitFor({ state: 'visible' })
  await page.locator('.agent-compose textarea').click()
  await page.locator('.bubble-selection').waitFor({ state: 'hidden' })
  await page.locator('.agent-compose textarea').fill('Help me plan the weekend using these notes.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.locator('.agent-status').waitFor()
  assert(
    !(await page.locator('.agent-status').innerText()).includes('Connecting'),
    'startup and generation must share the normal processing state',
  )
  await waitUntil('Claude API reply', async () => {
    if (await page.locator('.agent-error').isVisible())
      throw new Error(await page.locator('.agent-error').innerText())
    return (
      (await page.locator('.agent-markdown strong').count()) > 0 &&
      (await page.getByRole('button', { name: 'Send', exact: true }).isVisible())
    )
  })
  const firstAdapterPid = claudeAdapterPid()
  assert.equal(await page.locator('.agent-markdown strong').innerText(), 'one place')
  assert(
    toolResults.length > 0 && toolResults.every((result) => !result.is_error),
    JSON.stringify(toolResults),
  )
  assert(
    await page.locator('.agent-user .agent-selection').isVisible(),
    'the sent question must retain its quote',
  )
  assert.equal(
    await page.locator('.agent-context-strip').count(),
    0,
    'a sent quote must leave the composer',
  )
  assert.equal(await page.locator('.agent-files').count(), 0)
  assert(
    await page.locator('.agent-activity').isVisible(),
    'Melo document reads must appear in the activity summary',
  )
  const expandedBounds = await page.locator('.agent-window').boundingBox()
  await page.getByRole('button', { name: 'Minimize conversation', exact: true }).click()
  const dockBounds = await page.locator('.agent-window').boundingBox()
  assert.equal(dockBounds.height, 44)
  assert.equal(dockBounds.width, 44)
  assert.equal(await page.locator('.agent-resize').count(), 0)
  await page.mouse.move(dockBounds.x + 22, dockBounds.y + 22)
  await page.mouse.down()
  await page.mouse.move(dockBounds.x - 58, dockBounds.y - 58, { steps: 4 })
  await page.mouse.up()
  assert.equal(await page.locator('.agent-dock').count(), 1, 'dragging must not expand the capsule')
  const movedDock = await page.locator('.agent-window').boundingBox()
  assert.equal(movedDock.x, dockBounds.x - 80)
  assert.equal(movedDock.y, dockBounds.y - 80)
  await page.getByRole('button', { name: 'Expand conversation', exact: true }).click()
  assert.deepEqual(await page.locator('.agent-window').boundingBox(), expandedBounds)
  await page.getByRole('button', { name: 'Minimize conversation', exact: true }).click()
  assert.deepEqual(await page.locator('.agent-window').boundingBox(), movedDock)
  await page.getByRole('button', { name: 'Expand conversation', exact: true }).click()
  await page.locator('.agent-model').click()
  assert((await page.locator('.agent-picker-menu').innerText()).includes('melo-fixture'))
  assert(!(await page.locator('.agent-picker-menu').innerText()).includes('Opus'))
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.agent-markdown ul li').count(), 2)
  assert((await page.locator('.agent-markdown pre').innerText()).includes('Saturday'))
  if (process.env.MELO_E2E_API_SCREENSHOT) {
    await page.locator('.agent-body').evaluate((element) => {
      element.scrollTop = 0
    })
    await page.screenshot({ path: process.env.MELO_E2E_API_SCREENSHOT })
    const original = await page.locator('.agent-window').evaluate((element) => ({
      style: element.getAttribute('style'),
      theme: document.documentElement.getAttribute('data-theme'),
    }))
    await page.locator('.agent-window').evaluate((element) => {
      element.style.width = '360px'
      element.style.height = '520px'
      document.documentElement.setAttribute('data-theme', 'dark')
    })
    await page
      .locator('.agent-window')
      .screenshot({ path: process.env.MELO_E2E_API_SCREENSHOT.replace('.png', '-dark.png') })
    assert.equal(
      await page
        .locator('.agent-compose-actions')
        .evaluate((element) => element.scrollWidth > element.clientWidth),
      false,
    )
    await page.locator('.agent-window').evaluate((element, original) => {
      if (original.style === null) element.removeAttribute('style')
      else element.setAttribute('style', original.style)
      if (original.theme === null) document.documentElement.removeAttribute('data-theme')
      else document.documentElement.setAttribute('data-theme', original.theme)
    }, original)
  }
  await page.locator('.agent-body').evaluate((element) => {
    element.scrollTop = 100
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await page.locator('.agent-latest').waitFor()
  await page.getByRole('button', { name: 'Hide conversation', exact: true }).click()
  await page.locator('.ed-ask-melo').click()
  assert.equal(
    Math.round(await page.locator('.agent-body').evaluate((element) => element.scrollTop)),
    100,
    'reopening must retain the reading position',
  )
  await page.locator('.agent-latest').click()
  await page.locator('.agent-inline-file').filter({ hasText: 'Outside alias' }).click()
  await page.locator('.toast').filter({ hasText: 'no longer in the workspace' }).waitFor()
  assert(
    !(await editor.innerText()).includes('Outside workspace'),
    'Agent citations must not open an outside symlink target',
  )
  await page.locator('.agent-inline-file').filter({ hasText: 'Packing list' }).click()
  await waitUntil('open a cited file', async () => (await editor.innerText()).includes('Raincoat'))
  await page.locator('.agent-user .agent-quote-source').click()
  await waitUntil('open a quoted source', async () =>
    (await editor.innerText()).includes('riverside'),
  )

  await page.locator('.toast').waitFor({ state: 'hidden' })
  await page.locator('.agent-compose textarea').fill('edit_fixture')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.locator('.agent-permission[data-pending]').waitFor()
  assert.equal(claudeAdapterPid(), firstAdapterPid, 'consecutive turns must reuse the warm adapter')
  const approvalId = await page
    .locator('.agent-permission[data-pending]')
    .getAttribute('data-permission-id')
  assert(
    (await page.locator('.agent-edit-diff [data-kind="removed"]').innerText()).includes('Saturday'),
  )
  assert(
    (await page.locator('.agent-edit-diff [data-kind="added"]').innerText()).includes('Sunday'),
  )
  if (process.env.MELO_E2E_DIFF_SCREENSHOT)
    await page.locator('.agent-window').screenshot({ path: process.env.MELO_E2E_DIFF_SCREENSHOT })
  await page.getByRole('button', { name: 'Hide conversation', exact: true }).click()
  await page.locator('.ed-ask-melo').click()
  assert.equal(
    await page.locator('.agent-permission[data-pending]').getAttribute('data-permission-id'),
    approvalId,
    'reopening must keep the same approval',
  )
  const approvalWait = Number(process.env.MELO_AGENT_APPROVAL_WAIT_MS ?? 0)
  if (approvalWait) {
    console.log(`Holding a real Claude MCP approval for ${approvalWait} ms to verify its deadline.`)
    await new Promise((resolve) => setTimeout(resolve, approvalWait))
    assert(
      await page.locator('.agent-permission[data-pending]').isVisible(),
      'human review must outlive the former short MCP deadline',
    )
  }
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.locator('.agent-permission[data-pending]').waitFor({ state: 'hidden' })
  await page.locator('.agent-approval-status').filter({ hasText: 'no longer active' }).waitFor()
  assert(fs.readFileSync(file, 'utf8').includes('Saturday'))
  await page.locator('.agent-compose textarea').fill('edit_fixture')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.locator('.agent-permission[data-pending]').waitFor()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await waitUntil(
    'approved diff applied through the editor',
    async () =>
      fs.readFileSync(file, 'utf8').includes('Sunday') &&
      (await page.getByRole('button', { name: 'Send', exact: true }).isVisible()),
  )
  assert((await editor.innerText()).includes('Sunday'))
  await page
    .locator('.agent-changes')
    .last()
    .getByRole('button', { name: 'Undo', exact: true })
    .click()
  await waitUntil(
    'undo approved edit',
    async () =>
      fs.readFileSync(file, 'utf8').includes('Saturday') &&
      (await page.locator('.agent-runtime-select .sel-btn').isEnabled()),
  )
  await page.locator('.agent-compose textarea').fill('organize_fixture')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.locator('.agent-permission[data-pending]').waitFor()
  if (process.env.MELO_E2E_PERMISSION_SCREENSHOT)
    await page
      .locator('.agent-window')
      .screenshot({ path: process.env.MELO_E2E_PERMISSION_SCREENSHOT })
  await page.getByRole('button', { name: 'Allow for this run', exact: true }).click()
  await waitUntil('file change summary', async () => {
    if (await page.locator('.agent-error').isVisible())
      throw new Error(await page.locator('.agent-error').innerText())
    return (
      (await page.locator('.agent-changes').last().locator('.agent-change-row').count()) === 3 &&
      (await page.getByRole('button', { name: 'Send', exact: true }).isVisible())
    )
  })
  assert(fs.existsSync(path.join(workspace, 'Travel/packing.md')))
  assert.equal(
    await page.getByRole('button', { name: 'Ask before each change', exact: true }).count(),
    0,
    'run approval must expire at completion',
  )
  if (process.env.MELO_E2E_CHANGES_SCREENSHOT)
    await page
      .locator('.agent-window')
      .screenshot({ path: process.env.MELO_E2E_CHANGES_SCREENSHOT })
  await page.getByRole('button', { name: 'Undo all', exact: true }).click()
  await waitUntil(
    'undo file changes',
    async () =>
      (await page
        .locator('.agent-changes')
        .last()
        .locator('.agent-change-row[data-undone]')
        .count()) === 3,
  )
  assert(fs.existsSync(path.join(workspace, 'packing.md')))
  assert(!fs.existsSync(path.join(workspace, 'Reference')))
  assert(!fs.existsSync(path.join(workspace, 'Travel')))
  await page.locator('.agent-runtime-select .sel-btn').click()
  await page.getByRole('menuitem', { name: 'Codex', exact: true }).click()
  if (live || process.env.MELO_E2E_NATIVE_MODELS === '1') {
    await waitUntil(
      'Codex native authorization',
      async () => !(await page.locator('.agent-settings').isVisible()),
      15000,
    )
  } else {
    await page.locator('.agent-settings').waitFor()
    await page.locator('.agent-auth-actions .ui-button').waitFor()
    assert(
      (
        await page.locator('.agent-tool-card').filter({ hasText: 'Claude Code' }).innerText()
      ).includes('API configured'),
      'the inactive harness must retain its saved API status',
    )
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.locator('.agent-settings').waitFor({ state: 'hidden' })
    const settingsVisits = await page.evaluateHandle(() => {
      const state = { count: 0 }
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (
              node instanceof Element &&
              (node.matches('.agent-settings') || node.querySelector('.agent-settings'))
            )
              state.count++
          }
        }
      })
      observer.observe(document.querySelector('.agent-body'), { childList: true, subtree: true })
      return { state, stop: () => observer.disconnect() }
    })
    await page.locator('.agent-runtime-select .sel-btn').click()
    await page.getByRole('menuitem', { name: 'Claude Code', exact: true }).click()
    await waitUntil(
      'Claude API restored through the Harness menu',
      async () =>
        (await page.locator('.agent-model .sel-value').textContent()) === 'melo-fixture' &&
        (await page.locator('.agent-runtime-select .sel-btn').isEnabled()),
    )
    await page.evaluate(() => new Promise(requestAnimationFrame))
    assert.equal(
      await settingsVisits.evaluate((tracker) => tracker.state.count),
      0,
      'switching to a configured API must not visit connection settings',
    )
    await settingsVisits.evaluate((tracker) => tracker.stop())
    await settingsVisits.dispose()
    await page.locator('.agent-runtime-select .sel-btn').click()
    await page.getByRole('menuitem', { name: 'Connection settings', exact: true }).click()
    await page.getByLabel('API base URL', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'melo-fixture')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.locator('.agent-settings').waitFor({ state: 'hidden' })
  }

  if (process.env.MELO_E2E_NATIVE_MODELS === '1') {
    // Radix hides sibling controls from the accessibility tree while its menu is open.
    const modelPicker = page.locator('.agent-compose .sel-btn[aria-label="Model"]')
    await modelPicker.click()
    await waitUntil(
      'native controls loaded',
      async () =>
        (await modelPicker.getAttribute('aria-busy')) !== 'true' &&
        (await page.locator('.agent-picker-menu .sel-opt').count()) > 0,
      30000,
    )
    const choices = page.locator('.agent-picker-menu .sel-opt:not(.sel-active)')
    const nextModel = (await choices.allTextContents())[0]?.trim()
    if (nextModel) {
      await page.getByRole('menuitem', { name: nextModel, exact: true }).click()
      await waitUntil(
        'native model saved',
        async () =>
          (await modelPicker.isEnabled()) && (await modelPicker.innerText()).trim() === nextModel,
        30000,
      )
    } else await page.keyboard.press('Escape')
    const effortPicker = page.locator('.agent-compose .sel-btn[aria-label="Reasoning effort"]')
    await effortPicker.click()
    const nextEffort = (
      await page.locator('.agent-picker-menu .sel-opt:not(.sel-active)').allTextContents()
    )[0]?.trim()
    if (nextEffort) {
      await page.getByRole('menuitem', { name: nextEffort, exact: true }).click()
      await waitUntil(
        'native effort saved',
        async () =>
          (await effortPicker.isEnabled()) &&
          (await effortPicker.innerText()).trim() === nextEffort,
        30000,
      )
    } else await page.keyboard.press('Escape')
    const originalStyle = await page.locator('.agent-window').getAttribute('style')
    await page.locator('.agent-window').evaluate((element) => {
      element.style.width = '360px'
    })
    assert.equal(
      await page
        .locator('.agent-compose-actions')
        .evaluate((element) => element.scrollWidth > element.clientWidth),
      false,
      'native selectors must fit a narrow panel',
    )
    if (process.env.MELO_E2E_NATIVE_SCREENSHOT)
      await page
        .locator('.agent-window')
        .screenshot({ path: process.env.MELO_E2E_NATIVE_SCREENSHOT })
    await page.locator('.agent-window').evaluate((element, style) => {
      if (style === null) element.removeAttribute('style')
      else element.setAttribute('style', style)
    }, originalStyle)
  }

  const before = await page.locator('.agent-window').boundingBox()
  await page.mouse.move(before.x + 95, before.y + 20)
  await page.mouse.down()
  const dragDelta = before.x > 80 ? -60 : 60
  await page.mouse.move(before.x + 95 + dragDelta, before.y + 35)
  await page.mouse.up()
  await page.evaluate(() => new Promise(requestAnimationFrame))
  const after = await page.locator('.agent-window').boundingBox()
  assert(Math.abs(after.x - before.x) > 20, 'the floating conversation must be draggable')
  await page.locator('.agent-compose textarea').fill('Keep this unsent draft')
  await page.getByRole('button', { name: 'Hide conversation', exact: true }).click()
  await page.locator('.ed-ask-melo').click()
  assert.equal(
    Math.round((await page.locator('.agent-window').boundingBox()).x),
    Math.round(after.x),
    'reopening must keep the window position',
  )
  assert.equal(await page.locator('.agent-compose textarea').inputValue(), 'Keep this unsent draft')
  await editor.focus()
  await page.keyboard.press('Meta+a')
  // Move the non-modal window away from the selection toolbar, as a user can.
  const floating = await page.locator('.agent-window').boundingBox()
  const height = await page.evaluate(() => window.innerHeight)
  await page.mouse.move(floating.x + 90, floating.y + 18)
  await page.mouse.down()
  await page.mouse.move(floating.x + 90, height - floating.height - 16 + 18)
  await page.mouse.up()
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await page.locator('.bubble-btn.bubble-ask').click()
  assert(await page.locator('.agent-context-strip').isVisible())
  assert(
    await page
      .locator('.agent-compose textarea')
      .evaluate((element) => document.activeElement === element),
    'a repeated contextual invocation must focus the composer',
  )
  await page.getByRole('button', { name: 'Search chat history', exact: true }).click()
  await page.locator('.agent-search-field input').waitFor({ state: 'visible' })
  await editor.evaluate((element) => {
    element.focus()
    element.editor.commands.setTextSelection({ from: 1, to: 6 })
  })
  await page.locator('.bubble-ask').click()
  await page.locator('.agent-search').waitFor({ state: 'hidden' })
  assert(await page.locator('.agent-context-strip').isVisible())
  assert.equal(await page.locator('.bubble-selection').count(), 0)

  if (live) {
    await page
      .locator('.agent-compose textarea')
      .fill(
        'Use melo_read_document to read note.md, then melo_edit_document to append the exact line "Agent UI verified". Preserve the existing text. Use only the Melo tools. Briefly confirm completion.',
      )
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    let approved = 0
    await waitUntil(
      'live Codex conversation',
      async () => {
        const permission = page.locator('.agent-permission[data-pending]')
        if (await permission.isVisible()) {
          if (process.env.MELO_E2E_PERMISSION_SCREENSHOT)
            await page.screenshot({ path: process.env.MELO_E2E_PERMISSION_SCREENSHOT })
          await permission.getByRole('button', { name: 'Apply changes', exact: true }).click()
          approved++
        }
        if (await page.locator('.agent-error').isVisible())
          throw new Error(await page.locator('.agent-error').innerText())
        return await page.getByRole('button', { name: 'Send', exact: true }).isVisible()
      },
      240000,
    )
    assert(approved > 0, 'Melo must ask before modifying a document')
    assert(fs.readFileSync(file, 'utf8').includes('Agent UI verified'))
    assert(await editor.innerText().then((text) => text.includes('Agent UI verified')))
    assert(
      !fs.existsSync(path.join(workspace, 'logs')),
      'the harness must not run inherited hooks or create logs in the workspace',
    )
    assert((await page.locator('.agent-assistant').count()) > 0)
  }
  if (process.env.MELO_E2E_SCREENSHOT)
    await page.screenshot({ path: process.env.MELO_E2E_SCREENSHOT })
  await page.getByRole('button', { name: 'Hide conversation', exact: true }).click()
  await page.locator('.ed-ask-melo').click()
  assert(await page.locator('.agent-window').isVisible())
  const userCount = await page.locator('.agent-user').count()
  await page.getByRole('button', { name: 'Search chat history', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search chat history…' }).fill('riverside')
  await page.locator('.agent-search-result').first().waitFor()
  assert((await page.locator('.agent-search-result mark').count()) > 0)
  if (process.env.MELO_E2E_SEARCH_SCREENSHOT)
    await page.locator('.agent-window').screenshot({ path: process.env.MELO_E2E_SEARCH_SCREENSHOT })
  await page.keyboard.press('Enter')
  await page.locator('[data-highlight]').waitFor()
  assert.equal(await page.locator('.agent-user').count(), userCount)
  assert.equal(await page.locator('.agent-search').count(), 0)
  await page.locator('.sb-search').click()
  await page.locator('.pb-panel input').first().fill('What should I prepare for the weekend?')
  await page.locator('.pb-ask-notice').waitFor({ state: 'visible' })
  await page.locator('.pb-ask-notice').focus()
  await page.keyboard.press('Enter')
  await page.locator('.pb-panel').waitFor({ state: 'hidden' })
  assert.equal(
    await page.locator('.agent-compose textarea').inputValue(),
    'What should I prepare for the weekend?',
  )
  const errors = logs.filter((log) => log.includes('TypeError') || log.includes('ReferenceError'))
  assert.deepEqual(errors, [])
  passed = true
  console.log(
    `Agent E2E passed${live ? ' with an authorized Codex turn and a permission-gated document edit' : ''}.`,
  )
} finally {
  fixture.closeAllConnections()
  await new Promise((resolve) => fixture.close(resolve))
  // Reuse the established suite teardown: macOS stays alive after the last
  // window closes, so app.close() does not own a bounded cleanup path here.
  if (app) {
    if (!passed)
      await app
        .firstWindow()
        .then((page) => page.screenshot({ path: path.join(testRoot, 'failure.png') }))
        .catch(() => {})
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.close()
      })
      .catch(() => {})
    try {
      await waitUntil(
        'Agent and window teardown',
        () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 0),
        20000,
      )
    } catch (error) {
      passed = false
      process.exitCode = 1
      logs.push(String(error))
    }
    const child = app.process()
    const exited =
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once('exit', resolve))
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {})
    await exited
  }
  if (passed) fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  else {
    fs.writeFileSync(path.join(testRoot, 'electron.log'), logs.join('\n'))
    console.error(`Agent E2E diagnostics: ${testRoot}`)
  }
}
