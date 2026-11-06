import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import electronPath from 'electron'
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagedApp = process.argv.find((arg) => arg.startsWith('--app='))?.slice('--app='.length)
const executablePath = packagedApp
  ? path.join(path.resolve(packagedApp), 'Contents', 'MacOS', 'Melo')
  : electronPath
if (packagedApp) assert(fs.statSync(executablePath).isFile(), 'Packaged app must exist')
const testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'melo-agent-e2e-')))
const workspace = path.join(testRoot, 'workspace')
const profile = path.join(testRoot, 'profile')
const logs = []
const toolResults = []
const contextPrompts = new Map()
const catalogRequests = []
const attachmentImages = []
const scratchDirectories = new Set()
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'"
let intakeFiles
const live = process.env.MELO_AGENT_LIVE === '1'
async function installFixtureStorage(instance) {
  if (!process.argv.includes('--fixture-storage')) return
  assert(!live, 'Fixture storage must never be used with real accounts')
  // Runtime regressions do not need Keychain approval for an ad-hoc signed app.
  // Accept only the public fixture credential, never real user input.
  await instance.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => true
    safeStorage.encryptString = (value) => {
      if (value !== 'fixture-key') throw new Error('Unexpected fixture credential')
      return Buffer.from('fixture-key')
    }
    safeStorage.decryptString = () => 'fixture-key'
  })
}
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
  if (url.pathname === '/execution-probe') {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('Native network fixture')
    return
  }
  if (url.pathname.endsWith('/models')) {
    assert.equal(request.headers['x-api-key'], 'fixture-key')
    catalogRequests.push(url.pathname)
    await new Promise((resolve) => setTimeout(resolve, 350))
    if (catalogRequests.length > 1) {
      response.writeHead(503, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'fixture-key must never reach the UI' }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: 'melo-fixture', display_name: 'Melo fixture' }] }))
    return
  }
  if (!url.pathname.endsWith('/messages')) {
    response.writeHead(404)
    response.end()
    return
  }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  attachmentImages.push(
    ...body.messages.flatMap((message) =>
      Array.isArray(message.content)
        ? message.content.flatMap((block) =>
            block.type === 'image'
              ? [block]
              : block.type === 'tool_result' && Array.isArray(block.content)
                ? block.content.filter((item) => item.type === 'image')
                : [],
          )
        : [],
    ),
  )
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
  const sendTool = (name, input, id) => {
    const tool =
      body.tools.find((tool) => tool.name === name) ??
      body.tools.find((tool) => tool.name.includes(name))
    assert(tool, `Missing fixture tool: ${name}`)
    event('content_block_start', {
      index: 0,
      content_block: { type: 'tool_use', id, name: tool.name, input: {} },
    })
    event('content_block_delta', {
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
    })
    event('content_block_stop', { index: 0 })
    event('message_delta', {
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 10 },
    })
    event('message_stop', {})
    response.end()
  }
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
      message.content.some(
        (block) => block.type === 'tool_result' && block.tool_use_id === 'read_fixture',
      ),
  )
  if (!readTool && body.tools?.some((tool) => tool.name === 'ToolSearch')) {
    sendTool('ToolSearch', { query: 'melo', max_results: 20 }, 'discover_melo')
    return
  }
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
  if (currentRequest.startsWith('active_file_fixture'))
    contextPrompts.set(currentRequest, promptText)
  let metadataReply = ''
  if (currentRequest === 'tags_fixture' || currentRequest === 'smart_fixture') {
    const tags = currentRequest === 'tags_fixture'
    const blocks = body.messages.flatMap((message) =>
      Array.isArray(message.content) ? message.content : [],
    )
    const getResult = (id) =>
      blocks.findLast((block) => block.type === 'tool_result' && block.tool_use_id === id)
    const readId = tags ? 'metadata_tags_read' : 'metadata_smart_read'
    const writeId = tags ? 'metadata_tags_write' : 'metadata_smart_write'
    const read = getResult(readId)
    if (!read) {
      sendTool(
        tags ? 'melo_read_tags' : 'melo_read_smart_folders',
        tags ? { path: 'note.md' } : {},
        readId,
      )
      return
    }
    assert(!read.is_error, JSON.stringify(read.content))
    const snapshot = JSON.parse(
      Array.isArray(read.content)
        ? read.content.find((block) => block.type === 'text').text
        : read.content,
    )
    const view = {
      id: 'e2e-notes',
      name: 'Travel notes',
      glyph: 'tag',
      rules: [{ key: 'Tag', op: 'is', val: 'travel' }],
    }
    if (!tags && !getResult('metadata_preview')) {
      sendTool('melo_preview_smart_folder', { rules: view.rules }, 'metadata_preview')
      return
    }
    if (!getResult(writeId)) {
      sendTool(
        tags ? 'melo_update_tags' : 'melo_save_smart_folder',
        tags
          ? { path: 'note.md', expectedRevision: snapshot.revision, add: ['travel'], remove: [] }
          : { view, expectedRevision: snapshot.revision },
        writeId,
      )
      return
    }
    assert(!getResult(writeId).is_error, JSON.stringify(getResult(writeId).content))
    metadataReply = tags ? 'Tags updated.' : 'Smart Folder saved.'
  }
  const filing = currentRequest.includes('file_intake_fixture')
  const filingConfirmed = currentRequest.includes('file_intake_confirm_fixture')
  const filingQuestion = currentRequest.includes('file_intake_why_fixture')
  let filingReply = ''
  const organizing =
    (currentRequest.includes('organize_fixture') || filing) &&
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
  if (filingQuestion || filingConfirmed) {
    assert(
      promptText.includes('I suggest Travel/Hangzhou/Hotel.txt'),
      'follow-up retains the actual proposal',
    )
    if (filingQuestion)
      filingReply =
        'I suggested Hangzhou because the reservation is for a hotel there. Nothing has moved; shall I use that destination?'
    else {
      const completed = body.messages
        .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
        .find((block) => block.type === 'tool_result' && block.tool_use_id === 'filing_plan')
      if (!completed) {
        sendTool(
          'melo_organize_files',
          {
            files: intakeFiles.map((file) => ({
              id: file.id,
              reading: file.name === 'archive.bin' ? 'unread' : 'read',
              destination:
                file.name === 'archive.bin'
                  ? null
                  : file.name === 'reservation.txt'
                    ? 'Travel/Hangzhou/Hotel.txt'
                    : `Reference/${file.name}`,
            })),
          },
          'filing_plan',
        )
        return
      }
      assert(!completed.is_error, JSON.stringify(completed.content))
      filingReply =
        'Organized the three readable files in the agreed folders. The unread archive remains in Inbox.'
    }
  }
  if (
    filing &&
    body.tools?.some((tool) => tool.name.includes('melo_organize_files')) &&
    !body.messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .some((block) => block.type === 'tool_result' && block.tool_use_id === 'filing_plan')
  ) {
    const results = body.messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .filter((block) => block.type === 'tool_result')
    if (!results.some((block) => block.tool_use_id === 'filing_inspect')) {
      const intermediateScript =
        'import os,pathlib; p=pathlib.Path(os.environ["TMPDIR"])/"melo-pdf.txt"; p.write_text("".join(f"line-{n}: parsed PDF fixture\\n" for n in range(1,601))); print("melo-scratch-file="+str(p)); print("melo-scratch-root="+os.environ["CLAUDE_CODE_TMPDIR"])'
      sendTool(
        'Bash',
        {
          command:
            `(cd ${shellQuote(workspace)}; ` +
            "which pdftotext python3; ls -la Inbox; cat Inbox/reservation.txt; python3 -c 'import os,tempfile; f=tempfile.TemporaryFile(); f.write(b\"temporary-conversion\"); f.seek(0); print(f.read().decode())'; python3 -c '" +
            intermediateScript +
            "')",
          description: 'Read the attachment and inspect available parsing tools',
        },
        'filing_inspect',
      )
      return
    }
    const inspection = results.find((block) => block.tool_use_id === 'filing_inspect')
    assert(!inspection.is_error, 'routine inspection must execute without permission prompts')
    assert(JSON.stringify(inspection.content).includes('Reservation fixture: Hangzhou'))
    assert(JSON.stringify(inspection.content).includes('temporary-conversion'))
    const inspectionText =
      typeof inspection.content === 'string'
        ? inspection.content
        : inspection.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n')
    const intermediate = /melo-scratch-file=(.+)/.exec(inspectionText)?.[1].trim()
    const scratch = /melo-scratch-root=(.+)/.exec(inspectionText)?.[1].trim()
    assert(intermediate && scratch, 'the shell must expose its owned temporary paths')
    const scratchParts = scratch.split(path.sep)
    const ownedPart = scratchParts.findIndex((part) => /^melo-[A-Za-z0-9]{6}$/.test(part))
    assert(ownedPart >= 0, `Native temp path escaped the owned directory: ${scratch}`)
    const scratchRoot = scratchParts.slice(0, ownedPart + 1).join(path.sep)
    assert(
      intermediate.startsWith(scratch + path.sep),
      'parser TMPDIR must stay inside the owned scratch directory',
    )
    scratchDirectories.add(scratchRoot)
    if (!results.some((block) => block.tool_use_id === 'filing_scratch_write')) {
      sendTool(
        'Write',
        {
          file_path: path.join(scratch, 'analysis-note.txt'),
          content: 'Owned parser intermediate',
        },
        'filing_scratch_write',
      )
      return
    }
    assert(!results.find((block) => block.tool_use_id === 'filing_scratch_write').is_error)
    for (const offset of [1, 200, 500]) {
      const id = `filing_scratch_read_${offset}`
      const result = results.find((block) => block.tool_use_id === id)
      if (!result) {
        sendTool('Read', { file_path: intermediate, offset, limit: 60 }, id)
        return
      }
      assert(
        !result.is_error,
        'repeated native reads of parser intermediates must not require confirmation',
      )
      assert(JSON.stringify(result.content).includes(`line-${offset}: parsed PDF fixture`))
    }
    if (!results.some((block) => block.tool_use_id === 'filing_native_execution')) {
      const target = path.join(workspace, 'native-analysis.txt')
      sendTool(
        'Bash',
        {
          command: `printf 'Analysis fixture' > ${shellQuote(target)}; cat ${shellQuote(target)}; curl --fail --silent http://127.0.0.1:${fixture.address().port}/execution-probe`,
          description: 'Verify native execution without additional permissions',
        },
        'filing_native_execution',
      )
      return
    }
    const execution = results.find((block) => block.tool_use_id === 'filing_native_execution')
    assert(!execution.is_error, 'native execution must not require extra approval')
    assert(JSON.stringify(execution.content).includes('Analysis fixture'))
    assert(JSON.stringify(execution.content).includes('Native network fixture'))
    const next = intakeFiles.findIndex(
      (file, index) => !results.some((block) => block.tool_use_id === `filing_read_${index}`),
    )
    if (next >= 0) {
      sendTool(
        'Read',
        { file_path: path.join(workspace, 'Inbox', intakeFiles[next].name) },
        `filing_read_${next}`,
      )
      return
    }
    if (!results.some((block) => block.tool_use_id === 'filing_list')) {
      sendTool('melo_list_files', { directory: '' }, 'filing_list')
      return
    }
    intakeFiles.forEach((file, index) => {
      const result = results.find((block) => block.tool_use_id === `filing_read_${index}`)
      const content = Array.isArray(result.content)
        ? result.content
        : [{ type: 'text', text: result.content }]
      const text = content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
      const unread = file.name === 'archive.bin'
      if (!unread)
        assert(
          !result.is_error,
          `Native attachment read failed: ${file.name}: ${text.slice(0, 400)}`,
        )
      if (file.name === 'reservation.txt')
        assert(
          text.includes('Reservation fixture: Hangzhou hotel on Friday.'),
          'native Read must return actual attachment content',
        )
      if (file.name.endsWith('.pdf'))
        assert(
          content.some((block) => block.type === 'document' || block.type === 'image') ||
            text.includes('Melo PDF preview'),
          'native Read must forward PDF content to the model',
        )
    })
    filingReply =
      '==I suggest Travel/Hangzhou/Hotel.txt for the hotel reservation.==\n\nUse Reference for the PDF and image, and keep archive.bin in Inbox because it could not be read. Shall I organize them this way?'
  }
  const nextOrganize = organizing && !filing ? organizeActions[organized] : undefined
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
  if (!metadataReply && !organizing && readTool && !usedTool) {
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
      text:
        (currentRequest.startsWith('active_file_fixture') ? 'Current file received.' : '') ||
        metadataReply ||
        filingReply ||
        (editing
          ? 'Changed Saturday to Sunday.'
          : organizing
            ? 'The files are organized. Future articles can stay in Inbox until you decide where to keep them.'
            : fixtureReply),
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
  const existingFilingFolder = 'Family/Baby/Medical reports/2026/Checkups'
  fs.mkdirSync(path.join(workspace, existingFilingFolder), { recursive: true })
  fs.mkdirSync(profile)
  const codexHome = path.join(testRoot, 'codex-home')
  const claudeHome = path.join(testRoot, 'claude-home')
  fs.mkdirSync(codexHome)
  fs.mkdirSync(claudeHome)
  // Conversation regression uses an offline fixture; runtime downloads have
  // their own E2E. Seed only the test profile from the locked development CLI.
  const require = createRequire(import.meta.url)
  const adapterRequire = createRequire(
    require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js'),
  )
  const sdkRequire = createRequire(adapterRequire.resolve('@anthropic-ai/claude-agent-sdk'))
  const cli = sdkRequire.resolve(
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`,
  )
  const runtimeManifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'src/main/agent/runtime/runtimeManifest.json'), 'utf8'),
  )
  const runtime = runtimeManifest[`${process.platform}-${process.arch}`].claude
  fs.cpSync(
    path.dirname(cli),
    path.join(
      profile,
      'agent/runtime',
      `claude-v${runtime.version}-${process.platform}-${process.arch}`,
    ),
    { recursive: true },
  )

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
  fs.writeFileSync(
    path.join(workspace, 'tag-vocabulary.md'),
    '---\ntags: ["产品 设计", "读书笔记"]\n---\n# Tag examples\n',
  )
  fs.writeFileSync(
    path.join(workspace, 'empty-clip.md'),
    '---\nsource: https://example.com/article\n---\n# Clipped article\n\nArticle body.\n',
  )
  const launchOptions = {
    executablePath,
    args: packagedApp ? [] : [projectRoot],
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
  }
  app = await electron.launch(launchOptions)
  await installFixtureStorage(app)
  app.process().stderr?.on('data', (chunk) => logs.push(String(chunk)))
  const page = await app.firstWindow()
  page.setDefaultTimeout(packagedApp ? 30000 : 10000)
  page.on('pageerror', (error) => logs.push(error.stack ?? error.message))
  await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 30000 })
  await page
    .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'note' }) })
    .first()
    .click()
  const editor = page.locator('.tiptap[contenteditable="true"]').first()
  await editor.waitFor({ state: 'visible' })
  assert.equal(await page.locator('.ed-ask-melo').count(), 0)
  await page.locator('.agent-dock[data-intro]').waitFor()
  assert.equal(await page.locator('.agent-compose').count(), 0)
  await page.bringToFront()
  const initialDock = await page.locator('.agent-window').boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert.equal(viewport.width - initialDock.x - initialDock.width, 32)
  assert.equal(viewport.height - initialDock.y - initialDock.height, 96)
  await page.evaluate((bounds) => {
    const control = document.createElement('div')
    control.id = 'fixed-control-fixture'
    control.setAttribute('data-floating-obstacle', '')
    Object.assign(control.style, {
      position: 'fixed',
      left: `${bounds.x - 80}px`,
      top: `${bounds.y + 20}px`,
      width: '160px',
      height: '28px',
    })
    document.body.append(control)
  }, initialDock)
  await waitUntil(
    'mascot avoids a newly mounted fixed control',
    async () => (await page.locator('.agent-window').boundingBox()).y === initialDock.y - 40,
  )
  assert.equal(await page.evaluate(() => localStorage.getItem('melo.agent.dock-position')), null)
  await page.locator('#fixed-control-fixture').evaluate((element) => element.remove())
  await waitUntil(
    'mascot returns to its preferred default when the control disappears',
    async () => (await page.locator('.agent-window').boundingBox()).y === initialDock.y,
  )
  await page.locator('.agent-dock').hover()
  await page.mouse.move(initialDock.x + 22, initialDock.y + 22)
  await page.mouse.down()
  await page.mouse.move(initialDock.x - 38, initialDock.y - 38, { steps: 4 })
  await page.mouse.up()
  const savedDock = await page.locator('.agent-window').boundingBox()
  assert.equal(savedDock.x, initialDock.x - 60)
  assert.equal(savedDock.y, initialDock.y - 60)
  await page.reload()
  await page.locator('.agent-dock[data-intro]').waitFor()
  assert.deepEqual(await page.locator('.agent-window').boundingBox(), savedDock)
  if (process.env.MELO_E2E_DOCK_SCREENSHOT)
    await page.screenshot({ path: process.env.MELO_E2E_DOCK_SCREENSHOT })
  if (!live) {
    const originalBody = await editor.innerText()
    assert.equal(await page.locator('.document-tag').count(), 0)
    const emptyTags = page.locator('.document-tags-add')
    await page.mouse.move(20, 20)
    await page.getByRole('button', { name: 'More actions', exact: true }).focus()
    assert.equal(await emptyTags.evaluate((el) => getComputedStyle(el).opacity), '0')
    const titleBeforeHover = await editor.locator('h1').boundingBox()
    assert.equal((await page.locator('.document-tags').boundingBox()).height, 0)
    const normalTitleY = await page
      .locator('.ed-page')
      .evaluate(
        (el) => el.getBoundingClientRect().top + parseFloat(getComputedStyle(el).paddingTop),
      )
    assert.equal(titleBeforeHover.y, normalTitleY)
    if (process.env.MELO_E2E_TAGS_SCREENSHOT)
      await page.screenshot({
        path: process.env.MELO_E2E_TAGS_SCREENSHOT.replace('.png', '-empty.png'),
      })
    await editor.locator('h1').hover()
    assert.equal(await emptyTags.evaluate((el) => getComputedStyle(el).opacity), '1')
    assert.deepEqual(await editor.locator('h1').boundingBox(), titleBeforeHover)
    if (process.env.MELO_E2E_TAGS_SCREENSHOT)
      await page.screenshot({
        path: process.env.MELO_E2E_TAGS_SCREENSHOT.replace('.png', '-hover.png'),
      })
    await emptyTags.focus()
    await page.mouse.move(20, 20)
    assert.equal(await emptyTags.evaluate((el) => getComputedStyle(el).opacity), '1')
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Add tags', exact: true }).click()
    const tagEditor = page.locator('.document-tags[data-editing] .document-tags-row')
    await tagEditor.waitFor()
    assert.deepEqual(await editor.locator('h1').boundingBox(), titleBeforeHover)
    const tagInput = tagEditor.getByRole('combobox', { name: 'Add a tag', exact: true })
    await page.getByRole('option').filter({ hasText: '#产品 设计' }).waitFor()
    await tagInput.fill('输入中')
    await tagInput.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    assert.equal(await tagEditor.locator('.document-tag').count(), 0)
    await tagInput.fill('旅行计划')
    assert.deepEqual(await editor.locator('h1').boundingBox(), titleBeforeHover)
    await tagInput.press('Enter')
    await waitUntil(
      'first tag takes a metadata row',
      async () => (await editor.locator('h1').boundingBox()).y > titleBeforeHover.y,
    )
    await tagInput.fill('产品 设计')
    await tagInput.press('Enter')
    await waitUntil('inline tags saved', () =>
      fs.readFileSync(file, 'utf8').includes('tags: ["旅行计划","产品 设计"]'),
    )
    await tagInput.press('Escape')
    await tagEditor.waitFor({ state: 'hidden' })
    assert(
      await page
        .getByRole('button', { name: 'Edit tags…', exact: true })
        .evaluate((button) => document.activeElement === button),
    )
    assert.deepEqual(await page.locator('.document-tag').allTextContents(), [
      '#旅行计划',
      '#产品 设计',
    ])
    assert.equal(await editor.innerText(), originalBody)
    assert(fs.readFileSync(file, 'utf8').includes('tags: ["旅行计划","产品 设计"]'))
    if (process.env.MELO_E2E_TAGS_SCREENSHOT)
      await page.screenshot({ path: process.env.MELO_E2E_TAGS_SCREENSHOT })
    await page.getByRole('button', { name: '#产品 设计', exact: true }).click()
    await page.locator('.pb-panel').waitFor()
    await waitUntil('exact multi-word tag search', async () =>
      (await page.locator('.pb-row-title').allTextContents()).some(
        (title) => title === 'note.md' || title === 'note',
      ),
    )
    assert.equal(
      await page
        .locator('.sf-wrap')
        .innerText()
        .then((text) => text.includes('产品 设计')),
      true,
    )
    await page.keyboard.press('Escape')
    await page
      .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'packing' }) })
      .first()
      .click()
    assert.equal(await page.locator('.document-tag').count(), 0)
    await page
      .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'note' }) })
      .first()
      .click()
    await page.getByRole('button', { name: '#旅行计划', exact: true }).waitFor()
    await page.locator('.document-tags').hover()
    await page.getByRole('button', { name: 'Edit tags…', exact: true }).click()
    await tagEditor.waitFor()
    await tagInput.fill('产品')
    assert.equal(
      await page
        .getByRole('option')
        .filter({ hasText: '#产品 设计' })
        .getAttribute('aria-disabled'),
      'true',
    )
    if (process.env.MELO_E2E_TAGS_SCREENSHOT)
      await page.screenshot({
        path: process.env.MELO_E2E_TAGS_SCREENSHOT.replace('.png', '-edit.png'),
      })
    await tagInput.fill('')
    await tagInput.press('Backspace')
    assert.equal(await tagEditor.locator('[data-selected]').innerText(), '#产品 设计')
    await tagInput.press('Backspace')
    await waitUntil('tag removed with Backspace', () =>
      fs.readFileSync(file, 'utf8').includes('tags: ["旅行计划"]'),
    )
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await tagInput.press(`${modifier}+z`)
    await waitUntil('tag undo', () =>
      fs.readFileSync(file, 'utf8').includes('tags: ["旅行计划","产品 设计"]'),
    )
    await tagInput.press(`${modifier}+Shift+z`)
    await waitUntil('tag redo', () => fs.readFileSync(file, 'utf8').includes('tags: ["旅行计划"]'))
    await tagInput.press(`${modifier}+z`)
    await tagEditor.getByRole('button', { name: 'Remove #产品 设计', exact: true }).waitFor()
    await tagInput.press('Escape')
    await tagEditor.waitFor({ state: 'hidden' })
    await editor.hover()
    const removeTrip = page.getByRole('button', { name: 'Remove #旅行计划', exact: true })
    assert.equal(await removeTrip.evaluate((el) => getComputedStyle(el).opacity), '0')
    const tripTag = page.locator('.document-tag').filter({ hasText: '#旅行计划' })
    const tripBounds = await tripTag.boundingBox()
    await tripTag.hover()
    assert.equal(await removeTrip.evaluate((el) => getComputedStyle(el).opacity), '1')
    assert.deepEqual(await tripTag.boundingBox(), tripBounds)
    if (process.env.MELO_E2E_TAGS_SCREENSHOT)
      await page.screenshot({
        path: process.env.MELO_E2E_TAGS_SCREENSHOT.replace('.png', '-remove.png'),
      })
    await removeTrip.click()
    await waitUntil('hover removal saved without opening editing', () =>
      fs.readFileSync(file, 'utf8').includes('tags: ["产品 设计"]'),
    )
    assert.equal(await page.locator('.document-tags[data-editing]').count(), 0)
    assert.equal(await page.locator('.pb-panel').count(), 0)
    await page.keyboard.press(`${modifier}+z`)
    await waitUntil('undo direct hover removal', () =>
      fs.readFileSync(file, 'utf8').includes('tags: ["旅行计划","产品 设计"]'),
    )
    await page.keyboard.press(`${modifier}+Shift+z`)
    await waitUntil('redo direct hover removal', () =>
      fs.readFileSync(file, 'utf8').includes('tags: ["产品 设计"]'),
    )
    await page.locator('.document-tag').filter({ hasText: '#产品 设计' }).hover()
    await page.getByRole('button', { name: 'Remove #产品 设计', exact: true }).click()
    await waitUntil('all tags removed', () => fs.readFileSync(file, 'utf8').includes('tags: []'))
    assert.deepEqual(await editor.locator('h1').boundingBox(), titleBeforeHover)
    const bodyBounds = await editor.boundingBox()
    await editor.click({ position: { x: bodyBounds.width - 8, y: 8 } })
    await tagEditor.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.document-tag').count(), 0)
    assert.equal(await editor.innerText(), originalBody)
    await page.keyboard.press(`${modifier}+k`)
    const commandInput = page.locator('.sf-input')
    await commandInput.fill('> Add tags')
    await page
      .locator('.pb-row-title')
      .filter({ hasText: /^Add tags$/ })
      .waitFor()
    await commandInput.press('Enter')
    await page.locator('.pb-panel').waitFor({ state: 'hidden' })
    await tagInput.waitFor()
    assert(await tagInput.evaluate((el) => document.activeElement === el))
    await tagInput.press(`${modifier}+k`)
    await page.locator('.pb-panel').waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Edit tags…', exact: true }).click()
    await tagInput.waitFor()
    await tagInput.press('Escape')
    await page
      .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'empty-clip' }) })
      .first()
      .click()
    await page.locator('.ed-clip').waitFor()
    await editor.locator('h1').hover()
    const clipBanner = await page.locator('.ed-clip').boundingBox()
    const clipEntry = await emptyTags.boundingBox()
    const clipTitle = await editor.locator('h1').boundingBox()
    assert(clipEntry.y >= clipBanner.y + clipBanner.height)
    assert(clipEntry.y + clipEntry.height <= clipTitle.y)
    if (process.env.MELO_E2E_TAGS_SCREENSHOT)
      await page.screenshot({
        path: process.env.MELO_E2E_TAGS_SCREENSHOT.replace('.png', '-clip.png'),
      })
    await emptyTags.click()
    await tagInput.waitFor()
    assert.deepEqual(await editor.locator('h1').boundingBox(), clipTitle)
    await tagInput.press('Escape')
    await page
      .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'note' }) })
      .first()
      .click()
    await waitUntil(
      'back to note after empty clip check',
      async () => (await editor.innerText()) === originalBody,
    )
  }
  await page.locator('.agent-dock').click()
  await page.locator('.agent-window').waitFor({ state: 'visible' })
  await page.locator('.agent-welcome').waitFor()
  await page
    .locator('.agent-connect-option')
    .filter({ hasText: 'Claude Code' })
    .getByRole('button', { name: 'Sign in', exact: true })
    .waitFor()
  assert(
    await page.locator('.agent-compose textarea').isDisabled(),
    'first use must guide connection before chatting',
  )
  assert.equal(await page.locator('.agent-suggestions').count(), 0)
  assert.equal(await page.locator('.agent-runtime-select .sel-btn').count(), 0)
  await waitUntil(
    'both accounts checked',
    async () =>
      !(await page.locator('.agent-connect-option .agent-tool-status').allTextContents()).some(
        (text) => text.includes('Checking'),
      ),
  )
  if (process.env.MELO_E2E_WELCOME_SCREENSHOT)
    await page
      .locator('.agent-window')
      .screenshot({ path: process.env.MELO_E2E_WELCOME_SCREENSHOT })
  await page.getByRole('button', { name: 'Connect with an API Key instead', exact: true }).click()
  await page.getByLabel('API base URL', { exact: true }).waitFor()
  await page
    .locator('.agent-settings label')
    .filter({ hasText: 'API service' })
    .locator('.sel-btn')
    .click()
  await page.getByRole('menuitem', { name: 'Custom', exact: true }).click()
  await page.getByLabel('API base URL', { exact: true }).fill(fixtureUrl)
  await page.getByLabel('Model', { exact: true }).fill('invalid-model')
  await page.getByLabel('API key', { exact: true }).fill('fixture-key')
  await page.getByRole('button', { name: 'Verify and save', exact: true }).click()
  await page.locator('.agent-settings .agent-error').waitFor()
  assert((await page.locator('.agent-settings .agent-error').innerText()).includes('model ID'))
  assert(
    !(await page.locator('.agent-compose').isVisible()),
    'settings must not share the conversation composer',
  )
  assert.equal(catalogRequests.length, 0, 'opening settings must not fetch models')
  await page.getByRole('button', { name: 'Choose from list', exact: true }).click()
  const apiModel = page.locator('.agent-api-model .sel-btn')
  await apiModel.click()
  await page.locator('.sel-pop .sel-loading').waitFor()
  assert.equal(await apiModel.getAttribute('aria-busy'), null, 'loading belongs inside the menu')
  assert(
    (await apiModel.innerText()).includes('invalid-model'),
    'loading must preserve the draft selection',
  )
  await page.getByRole('menuitem', { name: 'Melo fixture', exact: true }).click()
  assert.equal(catalogRequests.length, 1)
  await apiModel.click()
  await page.getByRole('menuitem', { name: 'Melo fixture', exact: true }).waitFor()
  assert.equal(catalogRequests.length, 1, 'reopening a successful catalog uses the cache')
  await page.getByRole('menuitem', { name: 'Refresh models', exact: true }).click()
  await page
    .locator('.sel-pop [role="status"]')
    .filter({ hasText: 'temporarily unavailable' })
    .waitFor()
  assert.equal(catalogRequests.length, 2)
  await page.getByRole('menuitem', { name: 'Melo fixture', exact: true }).waitFor()
  assert(!(await page.locator('.sel-pop').innerText()).includes('fixture-key'))
  await page.keyboard.press('Escape')
  assert(
    (await page.locator('.agent-api-model [role="status"]').innerText()).includes(
      'temporarily unavailable',
    ),
  )
  await page.getByRole('button', { name: 'Enter model ID', exact: true }).click()
  assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'melo-fixture')
  if (packagedApp) console.log('Packaged Agent: saving the isolated API connection')
  await page.getByRole('button', { name: 'Verify and save', exact: true }).click()
  await page.locator('.agent-test-success').waitFor()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.locator('.agent-settings').waitFor({ state: 'hidden' })
  assert(
    await page.locator('.agent-compose textarea').evaluate((el) => document.activeElement === el),
    'returning from settings must restore composer focus',
  )
  await page.locator('.agent-transcript-empty .agent-suggestions').waitFor()
  assert(await page.locator('.agent-compose textarea').isEnabled())
  assert.equal(await page.locator('.agent-compose .agent-runtime-select .sel-btn').count(), 1)
  if (process.env.MELO_E2E_WELCOME_SCREENSHOT) {
    await page.mouse.move(0, 0)
    const screenshot = process.env.MELO_E2E_WELCOME_SCREENSHOT
    await page
      .locator('.agent-window')
      .screenshot({ path: screenshot.replace('.png', '-connected.png') })
    const style = await page.locator('.agent-window').getAttribute('style')
    await page.locator('.agent-window').evaluate((el) => {
      el.style.width = '360px'
      el.style.height = '520px'
    })
    assert.equal(
      await page
        .locator('.agent-compose-actions')
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    )
    await page
      .locator('.agent-window')
      .screenshot({ path: screenshot.replace('.png', '-narrow.png') })
    const theme = await page.evaluate(() => document.documentElement.dataset.theme)
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await page
      .locator('.agent-window')
      .screenshot({ path: screenshot.replace('.png', '-dark.png') })
    await page.evaluate((theme) => {
      if (theme) document.documentElement.dataset.theme = theme
      else delete document.documentElement.dataset.theme
    }, theme)
    await page
      .locator('.agent-window')
      .evaluate((el, style) => el.setAttribute('style', style), style)
  }
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
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
  // Keep the floating conversation clear of the heading's formatting toolbar.
  const quotePanel = await page.locator('.agent-window').boundingBox()
  await page.mouse.move(quotePanel.x + 80, quotePanel.y + 20)
  await page.mouse.down()
  await page.mouse.move(quotePanel.x + 240, quotePanel.y + 100, { steps: 8 })
  await page.mouse.up()
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
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
  await page.locator('.agent-dock[data-mode="working"]').waitFor()
  await page.locator('.agent-dock[data-mode="ready"]').waitFor({ timeout: 20000 })
  await page.mouse.move(30, 30)
  await page.locator('.agent-dock-bubble').waitFor({ state: 'hidden' })
  assert.equal(
    await page.locator('.agent-dock[data-mode="ready"]').count(),
    1,
    'the unread expression must survive the short announcement',
  )
  const firstAdapterPid = claudeAdapterPid()
  await page.locator('.agent-dock').click()
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
    'reopening must not attach a file chip or restore a sent quote',
  )
  assert.equal(await page.locator('.agent-files').count(), 0)
  assert(
    await page.locator('.agent-activity').isVisible(),
    'Melo document reads must appear in the activity summary',
  )
  const expandedBounds = await page.locator('.agent-window').boundingBox()
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
  const dockBounds = await page.locator('.agent-window').boundingBox()
  assert.equal(dockBounds.height, 48)
  assert.equal(dockBounds.width, 48)
  assert.equal(await page.locator('.agent-dock[data-intro]').count(), 0)
  if (process.env.MELO_E2E_DOCK_SCREENSHOT)
    await page.screenshot({
      path: process.env.MELO_E2E_DOCK_SCREENSHOT.replace('.png', '-ball.png'),
    })
  assert.equal(await page.locator('.agent-resize').count(), 0)
  await page.mouse.move(dockBounds.x + 22, dockBounds.y + 22)
  await page.mouse.down()
  await page.mouse.move(dockBounds.x - 58, dockBounds.y - 58, { steps: 4 })
  await page.mouse.up()
  assert.equal(await page.locator('.agent-dock').count(), 1, 'dragging must not expand the capsule')
  const movedDock = await page.locator('.agent-window').boundingBox()
  assert.equal(movedDock.x, dockBounds.x - 80)
  assert.equal(movedDock.y, dockBounds.y - 80)
  await page.getByRole('button', { name: 'Ask Melo', exact: true }).click()
  assert.deepEqual(await page.locator('.agent-window').boundingBox(), expandedBounds)
  await page.locator('.agent-compose textarea').focus()
  await page.keyboard.press('Escape')
  await page.locator('.agent-dock').waitFor()
  assert.deepEqual(await page.locator('.agent-window').boundingBox(), movedDock)
  assert(await page.locator('.agent-dock').evaluate((el) => document.activeElement === el))
  await page.getByRole('button', { name: 'Ask Melo', exact: true }).click()
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
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
  await page.locator('.agent-dock').click()
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
  const sourceCount = await page.locator('.agent-source-divider').count()
  assert.equal(await page.locator('.agent-context-strip').count(), 0)
  await page.locator('.agent-compose textarea').fill('active_file_fixture packing')
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  assert.equal(
    await page.locator('.agent-compose textarea').inputValue(),
    'active_file_fixture packing',
  )
  assert.equal(await editor.locator('h1').innerText(), 'Packing list')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await waitUntil('active packing file reaches Harness', async () =>
    contextPrompts.has('active_file_fixture packing'),
  )
  await page.locator('.agent-status').waitFor({ state: 'hidden' })
  assert(
    contextPrompts
      .get('active_file_fixture packing')
      .includes('editor at send time, relative to workspace: packing.md'),
  )
  assert.equal(await page.locator('.agent-source-divider').count(), sourceCount + 1)
  await page.locator('.agent-compose textarea').fill('A draft about packing')
  await page.locator('.agent-user .agent-quote-source').click()
  await waitUntil('open a quoted source', async () =>
    (await editor.innerText()).includes('riverside'),
  )
  assert.equal(await page.locator('.agent-context-strip').count(), 0)
  assert.equal(
    await page.locator('.agent-source-divider').count(),
    sourceCount + 1,
    'switching tabs without sending must not create history boundaries',
  )
  assert.equal(await page.locator('.agent-compose textarea').inputValue(), 'A draft about packing')
  await page.locator('.agent-compose textarea').fill('active_file_fixture note')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await waitUntil('active note reaches Harness without reopening chat', async () =>
    contextPrompts.has('active_file_fixture note'),
  )
  await page.locator('.agent-status').waitFor({ state: 'hidden' })
  assert(
    contextPrompts
      .get('active_file_fixture note')
      .includes('editor at send time, relative to workspace: note.md'),
  )
  assert.equal(await page.locator('.agent-source-divider').count(), sourceCount + 2)
  if (process.env.MELO_E2E_CONTEXT_SCREENSHOT)
    await page
      .locator('.agent-window')
      .screenshot({ path: process.env.MELO_E2E_CONTEXT_SCREENSHOT })

  await page.locator('.toast').waitFor({ state: 'hidden' })
  await page.locator('.agent-compose textarea').fill('edit_fixture')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.locator('.agent-permission[data-pending]').waitFor()
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
  await page.locator('.agent-dock[data-mode="waiting"]').waitFor()
  await page.locator('.agent-dock').hover()
  assert.equal(await page.locator('.agent-dock .melo-mascot').getAttribute('data-mood'), 'waiting')
  await page.locator('.agent-dock').click()
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
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
  await page.locator('.agent-dock').click()
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
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
  await page.locator('.agent-dock[data-mode="idle"]').waitFor()
  await page.locator('.agent-dock').click()
  const expired = page
    .locator('.agent-approval-record')
    .filter({ hasText: 'No longer active' })
    .last()
  await expired.locator(':scope > summary').waitFor()
  assert.equal(await expired.getAttribute('open'), null, 'superseded confirmations stay collapsed')
  await expired.locator(':scope > summary').focus()
  await page.keyboard.press('Enter')
  await expired.locator('.agent-approval-status').waitFor()
  await expired.locator(':scope > summary').click()
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
  if (!live) {
    const original = fs.readFileSync(file, 'utf8')
    for (const prompt of ['tags_fixture', 'smart_fixture']) {
      await page.locator('.agent-compose textarea').fill(prompt)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      const permission = page.locator('.agent-permission[data-pending]')
      await permission.waitFor()
      if (process.env.MELO_E2E_METADATA_SCREENSHOT)
        await permission.screenshot({
          path: process.env.MELO_E2E_METADATA_SCREENSHOT.replace('.png', `-${prompt}.png`),
        })
      await permission
        .getByRole('button', {
          name: prompt === 'tags_fixture' ? 'Apply changes' : 'Save',
          exact: true,
        })
        .click()
      await waitUntil(
        'metadata change completion',
        async () =>
          (await page.getByRole('button', { name: 'Send', exact: true }).isVisible()) &&
          (await page.locator('.agent-changes').last().innerText()).includes(
            prompt === 'tags_fixture' ? 'Tags updated' : 'Smart Folder saved',
          ),
      )
    }
    assert(fs.readFileSync(file, 'utf8').includes('tags: ["travel"]'))
    await page.getByRole('button', { name: '#travel', exact: true }).waitFor()
    await page.locator('.sf-row').filter({ hasText: 'Travel notes' }).waitFor()
    const matching = await page.evaluate(async () =>
      window.api.invoke(window.api.channels.InvokeQuerySmartView, {
        rules: [{ key: 'Tag', op: 'is', val: 'travel' }],
      }),
    )
    assert(matching.success && matching.data.total === 1)
    if (process.env.MELO_E2E_METADATA_SCREENSHOT)
      await page.screenshot({ path: process.env.MELO_E2E_METADATA_SCREENSHOT })
    await page
      .locator('.agent-changes')
      .last()
      .getByRole('button', { name: 'Undo', exact: true })
      .click()
    await page.locator('.sf-row').filter({ hasText: 'Travel notes' }).waitFor({ state: 'hidden' })
    const tagsReceipt = page.locator('.agent-changes').filter({ hasText: 'Tags updated' }).last()
    await tagsReceipt.getByRole('button', { name: 'Undo', exact: true }).click()
    await waitUntil(
      'undo tag-only metadata',
      async () => fs.readFileSync(file, 'utf8') === original,
    )
    assert.equal(await page.locator('.document-tag').count(), 0)
  }
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
  await page.locator('.agent-compose textarea').fill('Keep this draft while switching tools')
  await page.locator('.agent-runtime-select .sel-btn').click()
  await page.getByRole('menuitem', { name: 'Codex', exact: true }).click()
  if (live || process.env.MELO_E2E_NATIVE_MODELS === '1') {
    await waitUntil(
      'Codex native authorization',
      async () => !(await page.locator('.agent-settings').isVisible()),
      15000,
    )
  } else {
    await page.locator('.agent-welcome').waitFor()
    assert(
      (
        await page.locator('.agent-connect-option').filter({ hasText: 'Claude Code' }).innerText()
      ).includes('API configured'),
    )
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
    await page
      .locator('.agent-connect-option')
      .filter({ hasText: 'Claude Code' })
      .getByRole('button', { name: 'Use connection', exact: true })
      .click()
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

  assert.equal(
    await page.locator('.agent-compose textarea').inputValue(),
    'Keep this draft while switching tools',
  )
  await page.locator('.agent-compose textarea').fill('')

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

  // Leave vertical room for the document toolbar while testing repeated quotes.
  const resizeGrip = await page.locator('.agent-resize').boundingBox()
  await page.mouse.move(resizeGrip.x + resizeGrip.width / 2, resizeGrip.y + resizeGrip.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    resizeGrip.x + resizeGrip.width / 2,
    resizeGrip.y + resizeGrip.height / 2 - 120,
    { steps: 8 },
  )
  await page.mouse.up()
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
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
  await page.locator('.agent-dock').click()
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
  const existingPanel = await page.locator('.agent-window').elementHandle()
  const quoteBounds = await page.locator('.agent-window').boundingBox()
  await page.locator('.bubble-btn.bubble-ask').click()
  assert(await page.locator('.agent-context-strip').isVisible())
  assert.deepEqual(
    await page.locator('.agent-window').boundingBox(),
    quoteBounds,
    'quoting into an expanded chat must preserve its position and size',
  )
  assert(
    await existingPanel.evaluate((element) => element === document.querySelector('.agent-window')),
    'quoting must reuse the existing panel',
  )
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
  assert.deepEqual(
    await page.locator('.agent-window').boundingBox(),
    quoteBounds,
    'another quote must not reposition the panel',
  )
  await existingPanel.dispose()
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
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click()
  await page.locator('.agent-dock').click()
  assert(await page.locator('.agent-window').isVisible())
  const recentMessageIds = () =>
    page.evaluate(async () => {
      const result = await window.api.invoke(window.api.channels.AgentCommand, {
        action: 'history',
      })
      if (!result.success) throw new Error(result.error)
      return result.data.history.messages.map((message) => message.id)
    })
  const messagesBeforeSearch = await recentMessageIds()
  const savedChangeIds = () =>
    page.evaluate(async () => {
      const ids = []
      let before
      while (true) {
        const result = await window.api.invoke(window.api.channels.AgentCommand, {
          action: 'history',
          before,
        })
        if (!result.success) throw new Error(result.error)
        const history = result.data.history
        ids.push(
          ...history.messages.flatMap((message) => (message.change ? [message.change.id] : [])),
        )
        if (!history.hasOlder) return ids
        before = history.messages[0].sequence
      }
    })
  await page.getByRole('button', { name: 'Search chat history', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search chat history…' }).fill('riverside')
  await page.locator('.agent-search-result').first().waitFor()
  assert((await page.locator('.agent-search-result mark').count()) > 0)
  if (process.env.MELO_E2E_SEARCH_SCREENSHOT)
    await page.locator('.agent-window').screenshot({ path: process.env.MELO_E2E_SEARCH_SCREENSHOT })
  await page.keyboard.press('Enter')
  await page.locator('[data-highlight]').waitFor()
  // Jumping changes the rendered history page, but must not create or remove messages.
  assert.deepEqual(await recentMessageIds(), messagesBeforeSearch)
  assert.equal(await page.locator('.agent-search').count(), 0)
  const draftBeforeHandoff = await page.locator('.agent-compose textarea').inputValue()
  await page.locator('.sb-search').click()
  await page.locator('.pb-panel input').first().fill('What should I prepare for the weekend?')
  await page.locator('.pb-ask-notice').waitFor({ state: 'visible' })
  await page.locator('.pb-ask-notice').focus()
  await page.keyboard.press('Enter')
  await page.locator('.pb-panel').waitFor({ state: 'hidden' })
  assert.equal(
    await page.locator('.agent-compose textarea').inputValue(),
    [draftBeforeHandoff, 'What should I prepare for the weekend?'].filter(Boolean).join('\n\n'),
  )
  const existingDraft = await page.locator('.agent-compose textarea').inputValue()
  const searchWindowBounds = await page.locator('.agent-window').boundingBox()
  await page.locator('.sb-search').click()
  const searchInput = page.locator('.pb-panel input').first()
  await searchInput.fill('tag:tr')
  await searchInput.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    metaKey: true,
  })
  assert(await page.locator('.pb-panel').isVisible(), 'IME confirmation must not hand off to AI')
  await searchInput.press('Meta+Enter')
  await page.locator('.pb-panel').waitFor({ state: 'hidden' })
  assert.equal(
    await page.locator('.agent-compose textarea').inputValue(),
    existingDraft + '\n\ntag:tr',
  )
  const afterSearchBounds = await page.locator('.agent-window').boundingBox()
  assert.equal(afterSearchBounds.x, searchWindowBounds.x)
  assert.equal(afterSearchBounds.y, searchWindowBounds.y)
  await page.locator('.sb-search').click()
  await page.locator('.pb-panel input').first().fill('Find travel notes and create a Smart Folder')
  await page.locator('.pb-ask-notice').hover()
  assert.equal(
    await page.locator('.pb-list').evaluate((element) => element.scrollWidth > element.clientWidth),
    false,
  )
  if (process.env.MELO_E2E_PALETTE_SCREENSHOT)
    await page.screenshot({ path: process.env.MELO_E2E_PALETTE_SCREENSHOT })
  await page.keyboard.press('Escape')
  if (!live) {
    const sources = path.join(testRoot, 'intake-sources')
    fs.mkdirSync(sources)
    fs.writeFileSync(
      path.join(sources, 'reservation.txt'),
      'Reservation fixture: Hangzhou hotel on Friday.',
    )
    fs.writeFileSync(path.join(sources, 'archive.bin'), Buffer.from([0, 1, 2, 3]))
    // Stub reads in this isolated Electron process; never change the OS clipboard.
    await app.evaluate(({ clipboard, nativeImage }) => {
      globalThis.__meloIntakeClipboard = {
        readBuffer: clipboard.readBuffer,
        read: clipboard.read,
        readImage: clipboard.readImage,
      }
      clipboard.readBuffer = () => Buffer.alloc(0)
      clipboard.read = () => ''
      clipboard.readImage = () => nativeImage.createEmpty()
    })
    const paste = async (text) =>
      page.locator('.agent-compose textarea').evaluate((element, text) => {
        const data = new DataTransfer()
        data.setData('text/plain', text)
        element.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
        )
      }, text)
    const textarea = page.locator('.agent-compose textarea')
    await textarea.fill('')
    await paste('file_intake_fixture')
    await waitUntil(
      'ordinary textarea paste',
      async () => (await textarea.inputValue()) === 'file_intake_fixture',
    )
    const dropSource = path.join(workspace, 'packing.md')
    await page.locator('.agent-window').evaluate((element, source) => {
      const data = new DataTransfer()
      data.setData('application/x-melo-node', source)
      element.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }),
      )
    }, dropSource)
    await page.locator('.agent-compose[data-dragging-files]').waitFor()
    await page.locator('.agent-window').evaluate((element, source) => {
      const data = new DataTransfer()
      data.setData('application/x-melo-node', source)
      element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
      )
    }, dropSource)
    await page.getByRole('button', { name: 'Remove packing.md', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Got it', exact: true }).count(), 0)
    await page.locator('.agent-compose .agent-attachment').hover()
    await page.getByRole('button', { name: 'Remove packing.md', exact: true }).click()
    await waitUntil(
      'discard dropped draft',
      async () => (await page.locator('.agent-compose .agent-attachment').count()) === 0,
    )
    assert(fs.existsSync(dropSource))
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.id = 'intake-native-file-fixture'
      document.body.append(input)
    })
    await page
      .locator('#intake-native-file-fixture')
      .setInputFiles(path.join(sources, 'archive.bin'))
    await page.locator('.agent-window').evaluate((element) => {
      const input = document.querySelector('#intake-native-file-fixture')
      const data = new DataTransfer()
      data.items.add(input.files[0])
      element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
      )
      input.remove()
    })
    await page.getByRole('button', { name: 'Remove archive.bin', exact: true }).waitFor()
    await page.locator('.agent-compose .agent-attachment').hover()
    await page.getByRole('button', { name: 'Remove archive.bin', exact: true }).click()
    await waitUntil(
      'discard native file drop',
      async () => (await page.locator('.agent-compose .agent-attachment').count()) === 0,
    )
    const pdfStream =
      'BT /F1 24 Tf 24 190 Td (Melo PDF preview) Tj ET\n0.88 0.91 0.96 rg 24 120 270 40 re f\n'
    const pdfObjects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${Buffer.byteLength(pdfStream)} >>\nstream\n${pdfStream}endstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    let pdf = '%PDF-1.4\n'
    const offsets = [0]
    for (const [index, object] of pdfObjects.entries()) {
      offsets.push(Buffer.byteLength(pdf))
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    }
    const xref = Buffer.byteLength(pdf)
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    const pdfPath = path.join(sources, 'Statement.pdf')
    fs.writeFileSync(pdfPath, pdf)
    await app.evaluate(({ clipboard }, pdfPath) => {
      clipboard.readBuffer = (format) =>
        format === 'text/uri-list' ? Buffer.from(`file://${pdfPath}`) : Buffer.alloc(0)
    }, pdfPath)
    await paste('')
    await page
      .locator('.agent-compose .file-thumbnail[data-tone="pdf"][data-preview] img')
      .waitFor()
    if (process.env.MELO_E2E_INTAKE_SCREENSHOT)
      await page
        .locator('.agent-compose')
        .screenshot({ path: process.env.MELO_E2E_INTAKE_SCREENSHOT.replace('.png', '-pdf.png') })
    assert.equal(fs.readFileSync(pdfPath, 'utf8'), pdf)
    const urls = [path.join(sources, 'reservation.txt'), path.join(sources, 'archive.bin')]
      .map((file) => new URL(`file://${file}`).href)
      .join('\n')
    await app.evaluate(({ clipboard }, urls) => {
      clipboard.readBuffer = (format) =>
        format === 'text/uri-list' ? Buffer.from(urls) : Buffer.alloc(0)
    }, urls)
    await paste('do not insert a copied file path as text')
    await waitUntil(
      'PDF and two pasted files',
      async () => (await page.locator('.agent-compose .agent-attachment').count()) === 3,
    )
    await app.evaluate(({ clipboard, nativeImage }) => {
      clipboard.readBuffer = () => Buffer.alloc(0)
      clipboard.readImage = () =>
        nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 })
    })
    await paste('')
    await waitUntil(
      'pasted screenshot',
      async () => (await page.locator('.agent-compose .agent-attachment').count()) === 4,
    )
    await page.locator('.agent-compose .file-thumbnail[data-kind="image"] img').waitFor()
    assert.equal(await textarea.inputValue(), 'file_intake_fixture')
    assert(
      !fs.existsSync(path.join(workspace, 'Inbox/reservation.txt')),
      'drafts stay outside the workspace',
    )
    const drafts = await page.evaluate(async (workspace) => {
      const result = await window.api.invoke('agent-command', {
        action: 'draft-attachments',
        workspaceRoot: workspace,
      })
      return result.data.intake.attachments
    }, workspace)
    assert.equal(drafts.length, 4)
    assert(drafts.every((file) => !file.path))
    intakeFiles = drafts
    if (process.env.MELO_E2E_INTAKE_SCREENSHOT) {
      await page
        .locator('.agent-window')
        .screenshot({ path: process.env.MELO_E2E_INTAKE_SCREENSHOT })
      const original = await page.locator('.agent-window').evaluate((element) => ({
        style: element.getAttribute('style'),
        theme: document.documentElement.getAttribute('data-theme'),
      }))
      await page.locator('.agent-window').evaluate((element) => {
        element.style.width = '360px'
        document.documentElement.setAttribute('data-theme', 'dark')
      })
      await page.locator('.agent-window').screenshot({
        path: process.env.MELO_E2E_INTAKE_SCREENSHOT.replace('.png', '-dark-narrow.png'),
      })
      assert.equal(
        await page
          .locator('.agent-compose .agent-attachments')
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
    const changesBeforeFiling = await savedChangeIds()
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await waitUntil(
      'filing suggestion completes without an approval card',
      async () =>
        (await page.locator('.agent-assistant').last().innerText()).includes(
          'I suggest Travel/Hangzhou/Hotel.txt',
        ) && (await page.getByRole('button', { name: 'Send', exact: true }).isVisible()),
    )
    assert.equal(await page.locator('.agent-permission[data-pending]').count(), 0)
    assert.equal(
      await page.locator('.agent-assistant').last().locator('mark').innerText(),
      'I suggest Travel/Hangzhou/Hotel.txt for the hotel reservation.',
    )
    assert.equal(
      fs.readFileSync(path.join(workspace, 'Inbox/reservation.txt'), 'utf8'),
      'Reservation fixture: Hangzhou hotel on Friday.',
    )
    assert.equal(
      await page.locator('.agent-compose .agent-attachment').count(),
      0,
      'submitted attachments leave the composer',
    )
    const activity = page.locator('.agent-activity').last()
    assert.equal(
      (await activity.locator(':scope > summary').innerText()).trim(),
      'Processing details',
    )
    assert.equal(await activity.getAttribute('open'), null)
    assert.equal(await page.locator('.agent-native-record').count(), 0)
    assert.equal(await page.locator('.agent-error').count(), 0)
    await activity.locator(':scope > summary').click()
    assert(
      (await activity.locator('.agent-tool-label').allTextContents()).some(
        (label) => label.includes('Read file') && label.includes('Statement.pdf'),
      ),
    )
    const failedAttempt = activity.locator('.agent-tool[data-status="failed"]').first()
    await failedAttempt.waitFor()
    const attemptSummary = await failedAttempt.locator(':scope > summary').innerText()
    assert(attemptSummary.includes('Attempt unsuccessful'))
    assert(!attemptSummary.includes('printf'))
    if (process.env.MELO_E2E_INTAKE_SCREENSHOT) {
      await activity.scrollIntoViewIfNeeded()
      await page.locator('.agent-window').screenshot({
        path: process.env.MELO_E2E_INTAKE_SCREENSHOT.replace('.png', '-activity.png'),
      })
    }
    await failedAttempt.locator(':scope > summary').click()
    assert((await failedAttempt.locator('pre').first().innerText()).length > 0)
    await activity.locator(':scope > summary').click()
    assert.deepEqual(
      await savedChangeIds(),
      changesBeforeFiling,
      'Inbox receipt is not a file-change card',
    )
    assert(
      (await page.locator('.agent-receipt').last().innerText()).includes('4 files saved to Inbox'),
    )
    assert(
      !fs.existsSync(path.join(workspace, 'Travel/Hangzhou')),
      'filing must wait for user approval',
    )
    assert(!fs.existsSync(path.join(workspace, 'Reference')), 'a suggestion does not move files')
    await textarea.fill('file_intake_why_fixture: Why Hangzhou?')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await waitUntil(
      'explain the suggestion without cancelling or executing it',
      async () =>
        (await page.locator('.agent-assistant').last().innerText()).includes(
          'I suggested Hangzhou because',
        ) && (await page.getByRole('button', { name: 'Send', exact: true }).isVisible()),
    )
    assert(fs.existsSync(path.join(workspace, 'Inbox/reservation.txt')))
    assert(!fs.existsSync(path.join(workspace, 'Travel/Hangzhou')))
    assert.equal(await page.locator('.agent-permission[data-pending]').count(), 0)
    assert.equal(await page.locator('.agent-filing-result').count(), 0)
    if (process.env.MELO_E2E_INTAKE_SCREENSHOT)
      await page.locator('.agent-window').screenshot({
        path: process.env.MELO_E2E_INTAKE_SCREENSHOT.replace('.png', '-discussion.png'),
      })
    await textarea.fill(
      'file_intake_confirm_fixture: Yes, use Travel/Hangzhou/Hotel.txt and Reference, and leave the archive in Inbox.',
    )
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await waitUntil('file intake and filing', async () => {
      if (await page.locator('.agent-error').isVisible())
        throw new Error(await page.locator('.agent-error').innerText())
      return (
        fs.existsSync(path.join(workspace, 'Travel/Hangzhou/Hotel.txt')) &&
        fs.existsSync(path.join(workspace, 'Reference', drafts.at(-1).name)) &&
        fs.existsSync(path.join(workspace, 'Inbox/archive.bin')) &&
        (await page.getByRole('button', { name: 'Send', exact: true }).isVisible())
      )
    })
    assert(attachmentImages.length > 0, 'the installed Harness must receive image content')
    assert.equal(
      fs.readFileSync(path.join(sources, 'reservation.txt'), 'utf8'),
      'Reservation fixture: Hangzhou hotel on Friday.',
    )
    await page
      .locator('.agent-user')
      .getByRole('button', { name: 'reservation.txt', exact: true })
      .last()
      .click()
    await waitUntil('open an attachment after filing', async () =>
      (await editor.innerText()).includes('Reservation fixture'),
    )
    const filed = page.locator('.agent-filing-result').last()
    await filed.waitFor()
    assert.equal(await filed.locator('.agent-filing-details').getAttribute('open'), null)
    assert((await filed.locator('summary').innerText()).includes('Organized 3 files'))
    await page
      .locator('.agent-user')
      .filter({ hasText: 'file_intake_confirm_fixture' })
      .last()
      .click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete message', exact: true }).click()
    await waitUntil(
      'filing survives deletion of its question',
      async () =>
        (await page
          .locator('.agent-user')
          .filter({ hasText: 'file_intake_confirm_fixture' })
          .count()) === 0 && (await filed.locator('summary').innerText()) === 'Organized 3 files',
    )
    assert.equal(await page.locator('.agent-filing-result').count(), 1)
    assert.equal(await filed.locator('.agent-card-heading').count(), 0)
    assert.equal(await filed.evaluate((element) => getComputedStyle(element).boxShadow), 'none')
    if (process.env.MELO_E2E_INTAKE_SCREENSHOT) {
      await filed.scrollIntoViewIfNeeded()
      await page.locator('.agent-window').screenshot({
        path: process.env.MELO_E2E_INTAKE_SCREENSHOT.replace('.png', '-completed.png'),
      })
    }
    await filed.locator('summary').click()
    assert.equal(
      await filed.locator('.agent-filing-files .agent-quiet').count(),
      0,
      'expanded filing details must not offer a second undo action',
    )
    if (process.env.MELO_E2E_INTAKE_SCREENSHOT) {
      await filed.scrollIntoViewIfNeeded()
      await page.locator('.agent-window').screenshot({
        path: process.env.MELO_E2E_INTAKE_SCREENSHOT.replace('.png', '-expanded.png'),
      })
    }
    await filed.getByRole('button', { name: 'Undo this filing', exact: true }).click()
    await waitUntil('filing undo completes', async () => {
      const response = await page.evaluate(
        (workspaceRoot) => window.api.invoke('agent-command', { action: 'current', workspaceRoot }),
        workspace,
      )
      return (
        response.success &&
        response.data.view.status === 'idle' &&
        fs.existsSync(path.join(workspace, 'Inbox/reservation.txt')) &&
        fs.existsSync(path.join(workspace, 'Inbox', drafts.at(-1).name)) &&
        fs.existsSync(path.join(workspace, 'Inbox/Statement.pdf')) &&
        !fs.existsSync(path.join(workspace, 'Travel')) &&
        !fs.existsSync(path.join(workspace, 'Reference'))
      )
    })
    assert((await filed.locator('summary').innerText()).includes('Filing undone'))
    assert.equal(await filed.locator('.agent-filing-undo').count(), 0)
    await filed.locator('summary').click()
    if (process.env.MELO_E2E_INTAKE_SCREENSHOT)
      await page
        .locator('.agent-window')
        .screenshot({ path: process.env.MELO_E2E_INTAKE_SCREENSHOT.replace('.png', '-filed.png') })
    if (process.env.MELO_E2E_INTAKE_SCREENSHOT) {
      // Restore the persisted state of an interrupted write in the isolated profile.
      execFileSync(
        electronPath,
        [
          '-e',
          String.raw`
        const Database = require('better-sqlite3')
        const { randomUUID } = require('node:crypto')
        const database = new Database(process.argv[1])
        const workspaceRoot = process.argv[2]
        try {
          const conversation = randomUUID(), batchId = randomUUID(), createdAt = Date.now()
          database.transaction(() => {
            database.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?, ?)')
              .run(conversation, 'Interrupted filing fixture', workspaceRoot, 'claude', createdAt)
            database.prepare('INSERT INTO filing_batches (id,conversationId,workspaceRoot,createdAt,state,fileCount) VALUES (?, ?, ?, ?, ?, ?)')
              .run(batchId, conversation, workspaceRoot, createdAt, 'failed', 2)
            database.prepare("INSERT INTO messages (conversationId,id,role,content,createdAt,presentation) VALUES (?,?,'tool','',?,?)")
              .run(conversation, 'filing:' + batchId, createdAt, JSON.stringify({ filingId: batchId }))
            for (const [state, name] of [['undone', 'confirmed.pdf'], ['prepared', 'unconfirmed.pdf']]) {
              const id = randomUUID()
              database.prepare('INSERT INTO changes (id,conversationId,workspaceRoot,data,batchId) VALUES (?, ?, ?, ?, ?)')
                .run(id, conversation, workspaceRoot, JSON.stringify({ id, batchId, kind: 'move', source: 'Inbox/' + name, path: 'Reference/' + name, state, undone: state === 'undone' }), batchId)
            }
          })()
        } finally { database.close() }
      `,
          path.join(profile, 'agent/conversations.db'),
          workspace,
        ],
        {
          cwd: projectRoot,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        },
      )
      await page.reload()
      await page.locator('.sidebar').waitFor()
      await page
        .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'note' }) })
        .first()
        .click()
      await page.locator('.agent-dock').click()
      const unresolved = page.locator('.agent-filing-result').last()
      await waitUntil('interrupted filing stays unresolved after confirmed inverses', async () =>
        (await unresolved.locator('summary').innerText()).includes('Unconfirmed operations: 1'),
      )
      assert.equal(await unresolved.locator('.agent-filing-undo').count(), 0)
      await unresolved.locator('summary').click()
      assert(
        (await unresolved.locator('.agent-filing-unresolved').innerText()).includes(
          'Inbox/unconfirmed.pdf → Reference/unconfirmed.pdf',
        ),
      )
      assert.equal(await unresolved.locator('.agent-filing-unresolved button').count(), 0)
      await unresolved.scrollIntoViewIfNeeded()
      await page.locator('.agent-window').screenshot({
        path: process.env.MELO_E2E_INTAKE_SCREENSHOT.replace('.png', '-unresolved.png'),
      })
      await page.locator('.agent-window').evaluate((element) => {
        element.style.width = '360px'
        document.documentElement.setAttribute('data-theme', 'dark')
      })
      await unresolved.scrollIntoViewIfNeeded()
      assert.equal(
        await unresolved.evaluate((element) => element.scrollWidth > element.clientWidth),
        false,
      )
      await page.locator('.agent-window').screenshot({
        path: process.env.MELO_E2E_INTAKE_SCREENSHOT.replace('.png', '-unresolved-dark-narrow.png'),
      })
    }
    const cleared = await page.evaluate(() =>
      window.api.invoke('agent-command', { action: 'clear-history' }),
    )
    assert(cleared.success, cleared.error)
    for (const scratch of scratchDirectories)
      assert(!fs.existsSync(scratch), 'closing the owned Harness must remove parser intermediates')
    assert(fs.existsSync(path.join(workspace, 'Inbox/reservation.txt')))
    assert(fs.existsSync(path.join(workspace, 'Inbox', drafts.at(-1).name)))
    await app.evaluate(({ clipboard }) => {
      Object.assign(clipboard, globalThis.__meloIntakeClipboard)
      delete globalThis.__meloIntakeClipboard
    })
  }
  if (packagedApp && !live) {
    const child = app.process()
    const exited = new Promise((resolve) => child.once('exit', resolve))
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.close()
    })
    await waitUntil('close packaged app before restart', () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 0),
    )
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {})
    await exited
    app = await electron.launch(launchOptions)
    await installFixtureStorage(app)
    const restoredPage = await app.firstWindow()
    restoredPage.on('pageerror', (error) => logs.push(error.stack ?? error.message))
    await restoredPage.locator('.sidebar').waitFor()
    await restoredPage.locator('.agent-dock').click()
    const replies = await restoredPage.locator('.agent-markdown').count()
    await restoredPage.locator('.agent-compose textarea').fill('Verify the saved API connection.')
    await restoredPage.getByRole('button', { name: 'Send', exact: true }).click()
    await waitUntil(
      'packaged restart retains the working API credentials',
      async () =>
        (await restoredPage.locator('.agent-markdown').count()) > replies &&
        (await restoredPage.locator('.agent-markdown').last().innerText()).includes('Weekend plan'),
    )
    await restoredPage.locator('.agent-status').waitFor({ state: 'hidden' })
  }
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
