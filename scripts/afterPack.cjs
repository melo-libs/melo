const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function adHocSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  )

  // Keep unsigned builds structurally valid for Gatekeeper. When a Developer
  // ID is configured, electron-builder replaces this with the real signature.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  })
}
