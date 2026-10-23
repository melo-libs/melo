import { readFileSync } from 'node:fs'
import path from 'node:path'

export function supportsNativeMacUpdates(appDirectory: string): boolean {
  const manifest: { meloMacNativeUpdates?: unknown } = JSON.parse(
    readFileSync(path.join(appDirectory, 'package.json'), 'utf8'),
  )
  return manifest.meloMacNativeUpdates === true
}
