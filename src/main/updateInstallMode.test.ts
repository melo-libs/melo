import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { supportsNativeMacUpdates } from './updateInstallMode'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

it.each([undefined, false, 'true', 1, true])(
  'only an explicit packaged boolean enables native updates: %s',
  (value) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'melo-update-mode-'))
    directories.push(directory)
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ meloMacNativeUpdates: value }),
    )
    expect(supportsNativeMacUpdates(directory)).toBe(value === true)
  },
)
