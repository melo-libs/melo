import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  artifactPath,
  sha512,
  signatureRequirement,
  SIGNING_IDENTITY,
  releaseFiles,
} from './mac-release.mjs'
import { createRequire } from 'node:module'

test('explicit release configuration bypasses the stale root fileset', async () => {
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const { Packager } = builderRequire('app-builder-lib')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-release-config-'))
  try {
    const compiled = path.join(directory, 'staged', 'out')
    const configurationFile = path.join(directory, 'release.json')
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'release-fixture',
        version: '1.0.0',
        description: 'Release fixture',
        author: 'Melo',
      }),
    )
    fs.writeFileSync(path.join(directory, 'electron-builder.yml'), 'files:\n  - out/**/*\n')
    fs.writeFileSync(
      configurationFile,
      JSON.stringify({ extends: null, files: releaseFiles(compiled), mac: { notarize: false } }),
    )
    const packager = new Packager({
      projectDir: directory,
      config: { extends: configurationFile, mac: { sign: () => {} } },
    })
    await packager.validateConfig()
    assert.equal(packager.config.mac.notarize, false)
    const rootPatterns = packager.config.files
      .filter((entry) => !entry.from)
      .flatMap((entry) => entry.filter)
    assert.deepEqual(rootPatterns, ['resources/**/*', 'package.json'])
    const staged = packager.config.files.find((entry) => entry.from === compiled)
    assert.equal(staged.to, 'out')
    assert.deepEqual(staged.filter, ['**/*'])
  } finally {
    fs.rmSync(directory, { recursive: true })
  }
})

test('update artifacts cannot escape their release directory', () => {
  const directory = path.join(os.tmpdir(), 'melo-artifacts')
  assert.equal(
    artifactPath(directory, 'melo-lite-2.0.2-arm64.zip'),
    path.join(directory, 'melo-lite-2.0.2-arm64.zip'),
  )
  for (const invalid of [
    '',
    '.',
    '..',
    '../update.zip',
    '/update.zip',
    'x\\update.zip',
    '%2e%2e.zip',
    'https://example.com/update.zip',
  ]) {
    assert.throws(() => artifactPath(directory, invalid))
  }
})

test('native update verification pins the formal app ID and the stable certificate', () => {
  assert.equal(
    signatureRequirement(),
    `identifier "com.melolib.lite" and certificate root = H"${SIGNING_IDENTITY.toLowerCase()}"`,
  )
})

test('release checksums use the updater SHA-512 base64 encoding', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-release-hash-'))
  try {
    const file = path.join(directory, 'fixture.zip')
    const content = Buffer.from('Melo release fixture')
    fs.writeFileSync(file, content)
    assert.equal(await sha512(file), createHash('sha512').update(content).digest('base64'))
  } finally {
    fs.rmSync(directory, { recursive: true })
  }
})
