import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, _electron as electron } from 'playwright-core'
import electronPath from 'electron'

const visualUrl = process.argv.find((arg) => arg.startsWith('--visual-only='))?.slice(14)
const packaged = process.argv.find((arg) => arg.startsWith('--app='))?.slice(6)
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-runtime-e2e-'))
if (visualUrl) {
  const welcomeSource = await (
    await fetch(new URL('src/components/agent/AgentWelcome.tsx', visualUrl))
  ).text()
  const appSource = await (await fetch(new URL('src/main.tsx', visualUrl))).text()
  const reactUrl = welcomeSource.match(/from "([^"]*\/react\.js[^"]*)"/)[1]
  const domUrl = appSource.match(/from "([^"]*react-dom_client\.js[^"]*)"/)[1]
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const [state, theme, language, width] of [
      ['missing', 'light', 'zh-CN', 540],
      ['downloading', 'light', 'zh-CN', 540],
      ['error', 'light', 'zh-CN', 540],
      ['ready', 'dark', 'en', 400],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 620 }, deviceScaleFactor: 2 })
      const errors = []
      page.on('pageerror', (error) => {
        errors.push(error.message)
        console.error(error.message)
      })
      await page.route('**/@vite/client', (route) =>
        route.fulfill({
          contentType: 'text/javascript',
          body: 'export const injectQuery=(url,query)=>url+(url.includes("?")?"&":"?")+query;export const createHotContext=()=>({accept(){},prune(){},dispose(){},on(){},invalidate(){}});export function updateStyle(id,content){let el=document.getElementById(id);if(!el){el=document.createElement("style");el.id=id;document.head.append(el)}el.textContent=content}export function removeStyle(id){document.getElementById(id)?.remove()}',
        }),
      )
      await page.route('**/__runtime-preview', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html data-theme="${theme}"><body><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
        window.api={on:()=>()=>{}, invoke:async()=>({success:true,data:{}})};
        await import('/src/styles/index.scss'); await import('/src/components/agent/agent.scss');
        const {createElement}=(await import('${reactUrl}')).default;
        const {createRoot}=(await import('${domUrl}')).default;
        const {default:i18n}=await import('/src/i18n.ts'); 
        const {AgentWelcome}=await import('/src/components/agent/AgentWelcome.tsx'); await i18n.changeLanguage('${language}'); document.body.style.transition='none'; document.body.style.background='var(--paper)';
        const missing={status:'missing',source:null,transferred:0,total:122*1024*1024};
        const component={...missing,status:'${state}',source:'${state}'==='ready'?'local':null,transferred:41*1024*1024,error:'AGENT_DOWNLOAD_NETWORK'};
        createRoot(document.getElementById('root')).render(createElement('div',{style:{padding:'24px',display:'flex',height:'620px',alignItems:'center'}},createElement(AgentWelcome,{setup:{configuration:{provider:'claude',access:'native',baseUrl:'',model:'',hasApiKey:false},runtimeAvailable:'${state}'==='ready',installing:'${state}'==='downloading',components:{claude:component,codex:missing}},accounts:{claude:{status:'signed-out'},codex:{status:'signed-out'}},busy:false,onProvider:async()=>true,onLogin:async()=>{},onCheck:async()=>{},onSettings:()=>{}})));
      </script></body></html>`,
        }),
      )
      await page.goto(new URL('__runtime-preview', visualUrl).href)
      await page.locator('.agent-welcome h2').waitFor({ timeout: 10000 })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(250)
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      assert.deepEqual(errors, [])
      await page.screenshot({ path: path.join(artifacts, `${state}-${theme}.png`) })
      await page.close()
    }
  } finally {
    await browser.close()
  }
} else {
  const profile = path.join(artifacts, 'profile')
  const workspace = path.join(artifacts, 'workspace')
  const claudeHome = path.join(artifacts, 'claude')
  const codexHome = path.join(artifacts, 'codex')
  for (const directory of [profile, workspace, claudeHome, codexHome]) fs.mkdirSync(directory)
  fs.writeFileSync(path.join(workspace, 'note.md'), '# Runtime test\n')
  fs.writeFileSync(
    path.join(profile, 'preferences.json'),
    JSON.stringify({ lastDirectory: workspace }),
  )
  const env = {
    ...process.env,
    MELO_USER_DATA: profile,
    CLAUDE_CONFIG_DIR: claudeHome,
    CODEX_HOME: codexHome,
  }
  for (const key of [
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_RENDERER_URL',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
  ])
    delete env[key]
  const app = await electron.launch({
    executablePath: packaged ? path.join(packaged, 'Contents/MacOS/Melo') : electronPath,
    args: packaged ? [] : [process.cwd()],
    env,
    timeout: 30000,
  })
  try {
    const page = await app.firstWindow()
    await page.locator('.sidebar').waitFor({ timeout: 30000 })
    await page.locator('.agent-dock').click()
    await page.locator('.agent-welcome').waitFor()
    const command = (input) =>
      page.evaluate((command) => window.api.invoke('agent-command', command), input)
    const initial = await command({ action: 'setup' })
    assert(initial.success, initial.error)
    for (const provider of ['claude', 'codex']) {
      const before = initial.data.setup.components[provider]
      console.log(provider, before.status, before.source)
      // Exercise the real pinned downloads; never request login or use real accounts.
      const result = await command({ action: 'install', provider })
      assert(result.success, result.error)
      const component = result.data.setup.components[provider]
      assert.equal(component.status, 'ready')
      const auth = await command({ action: 'check-sign-in', provider })
      assert(auth.success, auth.error)
      assert.equal(auth.data.authentication.status, 'signed-out')
    }
    await page.screenshot({ path: path.join(artifacts, 'packaged-runtime.png') })
    console.log('Packaged/runtime IPC download and auth status passed')
  } finally {
    const child = app.process()
    const exited =
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once('exit', resolve))
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await exited
    for (const directory of [profile, workspace, claudeHome, codexHome])
      fs.rmSync(directory, { recursive: true, force: true })
  }
}
console.log(`Screenshots: ${artifacts}`)
