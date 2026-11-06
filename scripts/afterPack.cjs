const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

exports.default = async function adHocSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  const modules = path.join(appPath, 'Contents/Resources/app.asar.unpacked/node_modules')
  for (const [scope, prefix] of [
    ['@openai', 'codex-'],
    ['@anthropic-ai', 'claude-agent-sdk-'],
  ]) {
    const directory = path.join(modules, scope)
    if (!fs.existsSync(directory)) continue
    for (const name of fs.readdirSync(directory)) {
      if (!name.startsWith(prefix)) continue
      const payload = path.join(directory, name, scope === '@openai' ? 'vendor' : 'claude')
      if (fs.existsSync(payload))
        throw new Error(`Native AI payload must be downloaded on demand: ${name}`)
    }
  }

  // Keep unsigned builds structurally valid for Gatekeeper. When a Developer
  // ID is configured, electron-builder replaces this with the real signature.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  })
}
