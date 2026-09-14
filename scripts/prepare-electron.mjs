import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'

if (process.platform === 'darwin') {
  const appPath = path.resolve('node_modules/electron/dist/Electron.app')
  const verification = spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    stdio: 'ignore',
  })

  // Electron's npm archive carries only linker signatures. A complete ad-hoc
  // signature prevents current macOS security policy from deleting the dev app
  // as damaged code. Distribution signing can replace it later.
  if (verification.status !== 0) {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
      stdio: 'inherit',
    })
  }
}
