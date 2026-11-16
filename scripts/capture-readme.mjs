import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

// Capture real UI using disposable example notes, never the user's workspace or accounts.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(projectRoot, 'docs', 'images')
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'melo-readme-')))
const workspace = path.join(root, 'Melo Notes')
const profile = path.join(root, 'profile')
let app
let page
let completed = false

const notes = {
  'Inbox/Start here.md': `# From saved to understood

A good idea deserves more than another open tab. Keep the original, make a connection, and write something of your own.

## A small plan for this week

- [x] Collect a few things worth keeping
- [x] Connect them with [[Local-first notes]]
- [ ] Turn the best idea into a short draft

## Make the idea your own

> The useful part of a reading note is what you think about it.

| Keep | Connect | Create |
| --- | --- | --- |
| Articles and references | Notes, tags, and links | A clearer next step |

## A simple reading loop

\`\`\`mermaid
flowchart LR
  A[Collect] --> B[Organize]
  B --> C[Distill]
  C --> D[Express]
\`\`\`
`,
  'Reading/Local-first notes.md': `# Local-first notes

Your notes are ordinary Markdown files in a folder you choose. Open them in another editor, keep a backup, or move them when you want.

## What belongs together

- The source you saved
- The question it raised
- Your own explanation

Connect this note to [[A reading habit]] and [[Start here]].
`,
  'Reading/A reading habit.md': `# A reading habit

Read with a question in mind. Save the original, write a short summary, and connect the note to something you already know.

## A useful reading note

1. What is the main idea?
2. Why does it matter to my work?
3. What will I try next?

See [[Local-first notes]] for a simple way to keep the original close to your own thinking.
`,
  'Ideas/Questions worth keeping.md':
    '# Questions worth keeping\n\nWhat makes a note useful a month later?\n\nHow could local-first tools make room for an AI companion?\n',
  'Projects/Weekend writing.md':
    '# Weekend writing\n\n- [ ] Choose one idea\n- [ ] Gather the references\n- [ ] Write a first draft\n',
}

try {
  fs.mkdirSync(output, { recursive: true })
  fs.mkdirSync(profile)
  for (const [name, content] of Object.entries(notes)) {
    const file = path.join(workspace, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  for (const directory of ['claude', 'codex']) fs.mkdirSync(path.join(root, directory))
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({
      lastDirectory: workspace,
      language: 'en',
      settings: { theme: 'light', editorWidth: 'wide', autoUpdate: false },
    }),
  )
  const env = {
    ...process.env,
    MELO_USER_DATA: profile,
    CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
    CODEX_HOME: path.join(root, 'codex'),
  }
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
  app = await electron.launch({
    executablePath: electronPath,
    args: [projectRoot],
    cwd: projectRoot,
    env,
  })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow, shell }) => {
    const window = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('#main'),
    )
    window.setBounds({ x: 80, y: 60, width: 1440, height: 1040 })
    window.webContents.setZoomFactor(1)
    shell.openExternal = async () => {}
    shell.openPath = async () => ''
  })
  await page
    .locator('.tree-row', { has: page.locator('.tree-name', { hasText: 'Start here' }) })
    .click()
  await page.locator('pre.has-mermaid img').waitFor({ state: 'visible' })
  await page.evaluate(() => document.fonts.ready)
  const capture = async (name) => {
    await page.evaluate(() => document.activeElement?.blur())
    await page.mouse.move(0, 0)
    await page.locator('.agent-dock-bubble').waitFor({ state: 'hidden' })
    await page.screenshot({ path: path.join(output, name), scale: 'css', animations: 'disabled' })
  }
  await capture('workspace-light.png')
  await page.evaluate(() => window.api.invoke('invoke-set-settings', { patch: { theme: 'dark' } }))
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.waitForFunction(() => {
    const image = document.querySelector('pre.has-mermaid img')
    return image && !image.hidden && image.naturalWidth > 0
  })
  await capture('workspace-dark.png')
  await page.evaluate(() => window.api.invoke('invoke-set-settings', { patch: { theme: 'light' } }))
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.getByRole('button', { name: /Search workspace/ }).click()
  await page.locator('.sf-input').fill('local')
  await page
    .locator('.sf-trailing')
    .filter({ hasText: /\d+ results?/ })
    .waitFor()
  await page.locator('.pb-row-title', { hasText: 'Local-first notes' }).first().waitFor()
  await capture('search.png')
  await page.locator('.sf-input').focus()
  await page.keyboard.press('Escape')
  await page.locator('.pb-panel').waitFor({ state: 'hidden' })
  await page.locator('.agent-dock').click()
  await page.locator('.agent-window').waitFor()
  await page.getByText('Connect an AI tool to get started', { exact: true }).waitFor()
  await capture('ai-setup.png')
  completed = true
  console.log(`Saved README screenshots to ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {})
  console.error(`Screenshot diagnostics: ${root}`)
  throw error
} finally {
  if (app) {
    const timeout = setTimeout(() => app.process().kill('SIGTERM'), 5000)
    try {
      await app.close()
    } finally {
      clearTimeout(timeout)
    }
  }
  if (completed) fs.rmSync(root, { recursive: true, force: true })
}
