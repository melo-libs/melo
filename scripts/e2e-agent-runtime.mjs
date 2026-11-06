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
  const settingsSource = await (
    await fetch(new URL('src/components/agent/AgentSettings.tsx', visualUrl))
  ).text()
  const jotaiUrl = settingsSource.match(/from "([^"]*\/jotai\.js[^"]*)"/)[1]
  const appSource = await (await fetch(new URL('src/main.tsx', visualUrl))).text()
  const reactUrl = welcomeSource.match(/from "([^"]*\/react\.js[^"]*)"/)[1]
  const domUrl = appSource.match(/from "([^"]*react-dom_client\.js[^"]*)"/)[1]
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const scenarios = process.argv.includes('--startup-only')
      ? [
          ['startup-native', 'light', 'zh-CN', 800],
          ['startup-slow', 'light', 'zh-CN', 800],
          ['startup-api', 'dark', 'en', 800],
          ['startup-missing', 'light', 'zh-CN', 800],
          ['startup-signed-out', 'light', 'en', 800],
          ['startup-history', 'light', 'zh-CN', 800],
          ['startup-error', 'dark', 'en', 800],
        ]
      : process.argv.includes('--settings-only')
        ? [
            ['api-auth-error', 'light', 'zh-CN', 540],
            ['api-auth-error', 'dark', 'en', 400],
            ['api-verified', 'light', 'zh-CN', 540],
            ['api-verified', 'dark', 'en', 400],
            ['api-flow', 'light', 'zh-CN', 540],
            ['api-prepare-error', 'dark', 'en', 400],
            ['api-prepare-cancel', 'light', 'en', 400],
          ]
        : [
            ['missing', 'light', 'zh-CN', 540],
            ['downloading', 'light', 'zh-CN', 540],
            ['error', 'light', 'zh-CN', 540],
            ['ready', 'dark', 'en', 400],
          ]
    for (const [state, theme, language, width] of scenarios) {
      const page = await browser.newPage({
        viewport: { width, height: state.startsWith('startup-') ? 860 : 620 },
        deviceScaleFactor: 2,
      })
      const errors = []
      page.on('pageerror', (error) => {
        errors.push(error.message)
        console.error(error.message)
      })
      await page.route('**/@vite/client', (route) =>
        route.fulfill({
          contentType: 'text/javascript',
          body: 'export const injectQuery=(url,query)=>new URL(url,location.href).searchParams.has(query)?url:url+(url.includes("?")?"&":"?")+query;export const createHotContext=()=>({accept(){},prune(){},dispose(){},on(){},invalidate(){}});export function updateStyle(id,content){let el=document.getElementById(id);if(!el){el=document.createElement("style");el.id=id;document.head.append(el)}el.textContent=content}export function removeStyle(id){document.getElementById(id)?.remove()}',
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
        if ('${state}'.startsWith('startup-')) {
          const {AgentWindow}=await import('/src/components/agent/AgentWindow.tsx');
          const {appStore}=await import('/src/store/appStore.ts');
          const {agentSetupAtom,agentAccountsAtom,agentViewAtom,agentWindowAtom}=await import('/src/store/agent.ts');
          const {workspacePathAtom}=await import('/src/store/workspace.ts');
          const {Provider}=await import('${jotaiUrl}');
          const cached='${state}'==='startup-history';
          const setup={configuration:{provider:'claude',access:'${state}'==='startup-api'?'api':'native',baseUrl:'https://fixture.example',model:'fixture-model',hasApiKey:true,native:{model:'fixture-model'}},runtimeAvailable:'${state}'!=='startup-missing',installing:false};
          const view={conversation:{id:'startup',provider:'claude',workspaceRoot:'/fixture',title:'',updatedAt:1},messages:cached?[{id:'saved',role:'assistant',content:'Saved conversation stays visible.',createdAt:1}]:[],status:'idle',allowChanges:false,permission:null,error:null};
          window.probes=[];
          const accounts=[];
          window.api.invoke=async(channel,command)=>{
            if(channel!=='agent-command') return {success:true,data:{}};
            if(command.action==='current') return new Promise(resolve=>{window.finishCurrent=()=>resolve({success:true,data:{view}})});
            if(command.action==='setup') return 'startup-error'==='${state}'?{success:false,error:'AGENT_AUTH_CHECK_FAILED'}:{success:true,data:{setup}};
            if(command.action==='history') return {success:true,data:{history:{messages:[],hasOlder:false,hasNewer:false}}};
            if(command.action==='check-sign-in') {window.probes.push(command.provider);return new Promise(resolve=>accounts.push(()=>resolve({success:true,data:{authentication:{status:'${state}'==='startup-signed-out'?'signed-out':'signed-in'}}})));}
            if(command.action==='prepare') return {success:true,data:{setup}};
            return {success:true,data:{}};
          };
          window.finishAccounts=()=>accounts.splice(0).forEach(finish=>finish());
          appStore.set(workspacePathAtom,'/fixture');
          appStore.set(agentWindowAtom,{open:true,collapsed:false,context:{},anchor:null,draft:''});
          if(cached) {appStore.set(agentViewAtom,view);appStore.set(agentSetupAtom,setup);appStore.set(agentAccountsAtom,{claude:{status:'signed-in'},codex:{status:'signed-in'}});}
          window.sawConnectionGuide=false;
          new MutationObserver(()=>{if(document.querySelector('.agent-connect-options'))window.sawConnectionGuide=true}).observe(document.getElementById('root'),{childList:true,subtree:true});
          createRoot(document.getElementById('root')).render(createElement(Provider,{store:appStore},createElement(AgentWindow)));
        } else if ('${state}'.startsWith('api-')) {
          const {AgentSettings}=await import('/src/components/agent/AgentSettings.tsx');
          const {appStore}=await import('/src/store/appStore.ts');
          const {agentSetupAtom}=await import('/src/store/agent.ts');
          const {Provider}=await import('${jotaiUrl}');
          window.fixtureActions=[];
          window.installOutcome='${state}'==='api-prepare-cancel'?'cancel':'error';
          let fixture={configuration:{provider:'claude',access:'api',apiService:'deepseek',baseUrl:'https://api.deepseek.com/anthropic',model:'deepseek-flash',hasApiKey:true,apiVerified:'${state}'==='api-verified'},runtimeAvailable:!'${state}'.startsWith('api-prepare'),installing:false};
          window.api.invoke=async(channel,command)=>{
            if(channel!=='agent-command') return {success:true,data:{}};
            window.fixtureActions.push(command.action);
            if(command.action==='test-connection') return {success:true,data:{}};
            if(command.action==='configure') {
              if(command.apiKey==='invalid-fixture-key') return {success:false,error:'AGENT_API_AUTH_FAILED',data:{setup:fixture}};
              fixture={...fixture,configuration:{...fixture.configuration,apiVerified:true,model:command.model,baseUrl:command.baseUrl}};
            }
            if(command.action==='set-access') fixture={...fixture,configuration:{...fixture.configuration,access:command.access}};
            if(command.action==='install') {
              if(window.installOutcome!=='ready') return {success:false,error:window.installOutcome==='cancel'?'AGENT_DOWNLOAD_CANCELLED':'AGENT_DOWNLOAD_NETWORK',data:{setup:fixture}};
              fixture={...fixture,runtimeAvailable:true};
            }
            return {success:true,data:{setup:fixture}};
          };
          appStore.set(agentSetupAtom,fixture);
          const root=createRoot(document.getElementById('root'));
          let generation=0;
          window.remountSettings=()=>{ const key=++generation; root.render(createElement(Provider,{store:appStore},createElement('div',{style:{display:'flex',height:'620px'},'data-generation':key},createElement(AgentSettings,{key,accounts:{claude:{status:'signed-in'},codex:{status:'signed-in'}},onCheckAccount:()=>{},onLogin:async()=>{},onProviderChange:()=>{},onBusyChange:()=>{}})))); };
          window.remountSettings();

        } else {
        const missing={status:'missing',source:null,transferred:0,total:122*1024*1024};
        const component={...missing,status:'${state}',source:'${state}'==='ready'?'local':null,transferred:41*1024*1024,error:'AGENT_DOWNLOAD_NETWORK'};
        createRoot(document.getElementById('root')).render(createElement('div',{style:{padding:'24px',display:'flex',height:'620px',alignItems:'center'}},createElement(AgentWelcome,{setup:{configuration:{provider:'claude',access:'native',baseUrl:'',model:'',hasApiKey:false},runtimeAvailable:'${state}'==='ready',installing:'${state}'==='downloading',components:{claude:component,codex:missing}},accounts:{claude:{status:'signed-out'},codex:{status:'signed-out'}},busy:false,onProvider:async()=>true,onLogin:async()=>{},onCheck:async()=>{},onSettings:()=>{}})));
        }
      </script></body></html>`,
        }),
      )
      await page.goto(new URL('__runtime-preview', visualUrl).href)
      if (state.startsWith('startup-')) {
        await page.locator('.agent-window').waitFor()
        await page.waitForFunction(() => typeof window.finishCurrent === 'function')
        assert.equal(await page.locator('.agent-connect-options').count(), 0)
        if (state === 'startup-history') {
          assert.match(await page.locator('.agent-transcript').innerText(), /Saved conversation/)
          assert.equal(await page.locator('.agent-welcome').count(), 0)
        } else {
          await page.locator('.agent-welcome-logo').waitFor()
          const hint = page.locator('.agent-welcome-description')
          assert.equal(await hint.isVisible(), false)
          assert.equal(
            await page.locator('.agent-compose textarea').getAttribute('placeholder'),
            '',
          )
          assert.deepEqual(await page.evaluate(() => window.probes), [])
          await page.screenshot({ path: path.join(artifacts, `${state}-initial.png`) })
          if (state === 'startup-slow') {
            await hint.waitFor({ state: 'visible' })
            assert.equal(await page.locator('.agent-connect-options').count(), 0)
            await page.screenshot({ path: path.join(artifacts, 'startup-slow-hint.png') })
          }
        }
        await page.evaluate(() => window.finishCurrent())
        if (state === 'startup-error') {
          await page.locator('.agent-error').waitFor()
          assert.equal(await page.locator('.agent-connect-options').count(), 0)
        } else if (state === 'startup-missing') {
          await page.locator('.agent-connect-options').waitFor()
          assert.deepEqual(await page.evaluate(() => window.probes), [])
        } else if (state === 'startup-api') {
          await page.locator('.agent-empty').waitFor()
          assert.equal(await page.evaluate(() => window.sawConnectionGuide), false)
        } else {
          if (state !== 'startup-history') {
            await page.waitForFunction(() => window.probes.length === 2)
            assert.equal(await page.locator('.agent-connect-options').count(), 0)
            await page.evaluate(() => window.finishAccounts())
          }
          if (state === 'startup-signed-out') await page.locator('.agent-connect-options').waitFor()
          else {
            await page.waitForFunction(
              () => !document.querySelector('.agent-compose textarea').disabled,
            )
            assert.equal(await page.evaluate(() => window.sawConnectionGuide), false)
          }
        }
        await page.screenshot({ path: path.join(artifacts, `${state}-final.png`) })
        assert.deepEqual(errors, [])
        await page.close()
        continue
      } else if (state === 'api-auth-error' || state === 'api-flow') {
        await page.locator('input[type="password"]').fill('invalid-fixture-key')
        assert.equal(
          await page
            .locator('.agent-tool-card[aria-pressed="true"] .agent-tool-status')
            .getAttribute('data-state'),
          'api-unverified',
        )
        await page.locator('button[type="submit"]').click()
        await page.locator('.agent-settings [role="alert"]').waitFor()
        const feedback = await page.locator('[role="alert"]').boundingBox()
        assert(
          feedback && feedback.y >= 0 && feedback.y + feedback.height <= 620,
          'Connection error must scroll into view',
        )
        assert.equal(
          await page
            .locator('.agent-tool-card[aria-pressed="true"] .agent-tool-status')
            .getAttribute('data-state'),
          'api-error',
        )
        assert.equal(
          await page.locator('input[type="password"]').getAttribute('aria-invalid'),
          'true',
        )
        assert.equal(await page.locator('.agent-key-error').count(), 1)
        assert.equal(await page.locator('.agent-test-success').count(), 0)
        assert.equal(await page.evaluate(() => window.fixtureActions.includes('install')), false)
        if (state === 'api-flow') {
          await page.locator('input[type="password"]').fill('corrected-fixture-key')
          await page.locator('button[type="submit"]').click()
          await page.locator('.agent-test-success').waitFor()
          assert.equal(await page.locator('input[type="password"]').inputValue(), '')
          await page.evaluate(() => window.remountSettings())
          await page.locator('[data-generation="2"]').waitFor()
          await page.locator('.agent-test-success').waitFor()
          assert.equal(await page.locator('button[type="submit"]').innerText(), '测试连接')
          await page.locator('button[type="submit"]').click()
          await page.waitForFunction(() => window.fixtureActions.includes('test-connection'))
          assert.equal(
            (await page.evaluate(() => window.fixtureActions)).filter(
              (action) => action === 'test-connection',
            ).length,
            1,
          )
          await page.locator('input[type="password"]').fill('invalid-fixture-key')
          assert.equal(await page.locator('button[type="submit"]').innerText(), '验证并保存')
          await page.locator('button[type="submit"]').click()
          await page.locator('.agent-key-error').waitFor()
          assert.equal(
            await page.locator('input[type="password"]').inputValue(),
            'invalid-fixture-key',
          )
          await page.evaluate(() => window.remountSettings())
          await page.locator('[data-generation="3"]').waitFor()
          await page.locator('.agent-test-success').waitFor()
          assert.equal(await page.locator('button[type="submit"]').innerText(), '测试连接')
          await page.locator('input[type="password"]').fill('replacement-draft')
          await page.locator('.agent-tool-status[data-state="api-unverified"]').waitFor()
          assert.equal(
            await page.locator('.agent-tool-status').first().getAttribute('data-state'),
            'api-unverified',
          )
          await page.locator('input[type="password"]').fill('')
          await page.locator('.agent-test-success').waitFor()
          await page.locator('.agent-access-mode .seg-opt').first().click()
          await page.locator('.agent-auth').waitFor()
          await page.locator('.agent-access-mode .seg-opt').last().click()
          await page.locator('.agent-test-success').waitFor()
          assert.equal(
            (await page.evaluate(() => window.fixtureActions)).filter(
              (action) => action === 'configure',
            ).length,
            3,
          )
          await page.locator('.agent-api-model-meta button').click()
          const model = page.locator('.agent-api-model input')
          await model.fill('another-model')
          await page.locator('.agent-tool-status[data-state="api-unverified"]').waitFor()
          assert.equal(
            await page.locator('.agent-tool-status').first().getAttribute('data-state'),
            'api-unverified',
          )
          await model.fill('deepseek-flash')
          await page.locator('.agent-test-success').waitFor()
        }
      } else if (state.startsWith('api-prepare')) {
        await page.locator('input[type="password"]').fill('corrected-fixture-key')
        await page.locator('button[type="submit"]').click()
        await page.waitForFunction(() => window.fixtureActions.includes('install'))
        await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled)
        assert.equal(await page.locator('.agent-test-success').count(), 0)
        assert.equal(
          await page.locator('.agent-tool-status').first().getAttribute('data-state'),
          'api-connected',
        )
        assert.equal(
          await page.locator('input[type="password"]').getAttribute('aria-invalid'),
          null,
        )
        assert.equal(
          await page.locator('.agent-runtime [role="alert"]').count(),
          state === 'api-prepare-error' ? 1 : 0,
        )
        await page.evaluate(() => {
          window.installOutcome = 'ready'
        })
        await page.locator('.agent-runtime button').click()
        await page.locator('.agent-test-success').waitFor()
      } else if (state === 'api-verified') {
        await page.locator('.agent-tool-status[data-state="api-connected"]').waitFor()
        assert.equal(await page.locator('[role="alert"]').count(), 0)
        assert.deepEqual(await page.evaluate(() => window.fixtureActions), [])
      } else {
        await page.locator('.agent-welcome h2').waitFor({ timeout: 10000 })
      }
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(250)
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      assert.deepEqual(errors, [])
      await page.screenshot({ path: path.join(artifacts, `${state}-${theme}.png`) })
      if (state === 'api-auth-error') {
        await page.locator('input[type="password"]').fill('corrected-fixture-key')
        assert.equal(await page.locator('[role="alert"]').count(), 0)
        assert.equal(
          await page
            .locator('.agent-tool-card[aria-pressed="true"] .agent-tool-status')
            .getAttribute('data-state'),
          'api-unverified',
        )
      }
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
