import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-agent-preview-'))
const profile = path.join(testRoot, 'profile')
const workspace = path.join(testRoot, 'workspace')
const claudeHome = path.join(testRoot, 'claude')
const codexHome = path.join(testRoot, 'codex')

try {
  for (const directory of [profile, workspace, claudeHome, codexHome]) fs.mkdirSync(directory)
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ lastDirectory: workspace }),
  )
  fs.writeFileSync(
    path.join(workspace, 'Welcome.md'),
    '# Agent preview\n\nThis workspace is temporary. Open Melo to try connecting an AI tool.\n',
  )
  console.log('Opening an isolated Melo window. Quit with Cmd+Q; temporary data will be removed.')
  const env = {
    ...process.env,
    MELO_USER_DATA: profile,
    CLAUDE_CONFIG_DIR: claudeHome,
    CODEX_HOME: codexHome,
  }
  // A preview must not inherit a terminal's API credentials or development server.
  for (const key of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_RENDERER_URL',
  ])
    delete env[key]
  const child = spawn(electronPath, [projectRoot], { cwd: projectRoot, env, stdio: 'inherit' })
  const stop = () => child.kill('SIGTERM')
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolve(signal ? 130 : (code ?? 1)))
    })
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
