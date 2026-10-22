import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const yaml = appBuilderRequire('js-yaml')
const asar = appBuilderRequire('@electron/asar')
const { build, Platform, Arch } = require('electron-builder')
const { signAsync } = appBuilderRequire('@electron/osx-sign')
const { rebuild } = require('@electron/rebuild')

// Changing this breaks native upgrades from previously signed releases.
export const SIGNING_IDENTITY = '125C912085E6A07277A8F679B26F8628D6826E09'
export const APP_ID = 'com.melolib.lite'
const signingDirectory = path.join(os.homedir(), 'Library/Application Support/Melo Release Signing')
const packageInfo = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'))
const releaseNotes = path.join(project, 'docs/releases', `${packageInfo.version}.md`)

function run(binary, args, options = {}) {
  return execFileSync(binary, args, { cwd: project, stdio: 'inherit', ...options })
}

export function signatureRequirement() {
  return `identifier "${APP_ID}" and certificate root = H"${SIGNING_IDENTITY.toLowerCase()}"`
}

function verifyApp(app, nativeUpdates, compiledFiles) {
  const args = ['--verify', '--deep', '--strict', '--all-architectures']
  if (nativeUpdates) args.push('-R', `=${signatureRequirement()}`)
  run('/usr/bin/codesign', [...args, app])
  const metadata = JSON.parse(
    asar.extractFile(path.join(app, 'Contents/Resources/app.asar'), 'package.json').toString(),
  )
  assert.equal(metadata.version, packageInfo.version)
  assert.equal(metadata.meloMacNativeUpdates, nativeUpdates)
  for (const entry of compiledFiles) {
    const content = asar.extractFile(
      path.join(app, 'Contents/Resources/app.asar'),
      `out/${entry.file}`,
    )
    assert.equal(
      createHash('sha512').update(content).digest('base64'),
      entry.sha512,
      `Packaged code differs from the current build: ${entry.file}`,
    )
  }
  const feed = yaml.load(
    fs.readFileSync(path.join(app, 'Contents/Resources/app-update.yml'), 'utf8'),
  )
  assert.equal(feed.provider, 'github')
  assert.equal(feed.owner, 'melo-libs')
  assert.equal(feed.repo, 'melo')
}

export function artifactPath(directory, name) {
  assert(typeof name === 'string' && name.length > 0 && path.basename(name) === name)
  assert(!name.includes('\\') && !name.includes('%') && name !== '.' && name !== '..')
  return path.join(directory, name)
}

export async function sha512(file) {
  const hash = createHash('sha512')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('base64')
}

export function releaseFiles(compiled) {
  return [{ from: compiled, to: 'out', filter: ['**/*'] }, 'resources/**/*', 'package.json']
}

async function verifyArtifacts(output, architectures, nativeUpdates, compiledFiles) {
  const files = new Set()
  const extraction = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-release-verify-'))
  try {
    for (const name of fs.readdirSync(output).filter((entry) => /^latest.*\.yml$/.test(entry))) {
      const feed = yaml.load(fs.readFileSync(path.join(output, name), 'utf8'))
      assert.equal(feed.version, packageInfo.version)
      assert(Array.isArray(feed.files) && feed.files.length > 0)
      for (const entry of feed.files) {
        const file = artifactPath(output, entry.url)
        assert.equal(fs.statSync(file).size, entry.size)
        assert.equal(await sha512(file), entry.sha512)
        files.add(entry.url)
      }
      files.add(name)
    }
    for (const arch of architectures) {
      const stem = `${packageInfo.name}-${packageInfo.version}-${arch}`
      const zip = `${stem}.zip`
      const dmg = `${stem}.dmg`
      assert(files.has(zip) && files.has(dmg), `Update feed is missing ${arch} artifacts`)
      const destination = path.join(extraction, arch)
      run('/usr/bin/ditto', ['-x', '-k', path.join(output, zip), destination])
      verifyApp(path.join(destination, 'Melo.app'), nativeUpdates, compiledFiles)
      run('/usr/bin/hdiutil', ['verify', path.join(output, dmg)])
      // Extract one architecture at a time; a pair of Electron apps is large.
      fs.rmSync(destination, { recursive: true })
    }
    for (const name of fs.readdirSync(output).filter((entry) => entry.endsWith('.blockmap'))) {
      files.add(name)
    }
    return [...files].sort()
  } finally {
    fs.rmSync(extraction, { recursive: true, force: true })
  }
}

function keychains() {
  return [
    ...run('/usr/bin/security', ['list-keychains', '-d', 'user'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).matchAll(/"([^"]+)"/g),
  ].map((match) => match[1])
}

async function buildMac(args) {
  const unsigned = args.includes('--unsigned')
  const architectures = args.includes('--universal') ? ['universal'] : ['arm64', 'x64']
  assert(
    args.every((arg) => ['--unsigned', '--universal'].includes(arg)),
    'Unknown build option',
  )
  const output = path.join(
    project,
    'dist',
    `macos-${packageInfo.version}${unsigned ? '-unsigned' : ''}${architectures[0] === 'universal' ? '-universal' : ''}`,
  )
  const keychain =
    process.env.MELO_MAC_SIGNING_KEYCHAIN || path.join(signingDirectory, 'melo.keychain-db')
  const originalKeychains = unsigned ? [] : keychains()
  if (!unsigned) {
    assert(fs.existsSync(keychain), 'Missing signing Keychain. See docs/mac-release.md')
    const passwordFile =
      process.env.MELO_MAC_SIGNING_PASSWORD_FILE || path.join(signingDirectory, 'password')
    if (fs.existsSync(passwordFile)) {
      // execFileSync errors echo argv, which would expose the Keychain password.
      const unlock = spawnSync(
        '/usr/bin/security',
        ['unlock-keychain', '-p', fs.readFileSync(passwordFile, 'utf8'), keychain],
        { stdio: 'pipe' },
      )
      assert.equal(unlock.status, 0, 'Could not unlock the signing Keychain')
    }
    const identities = run('/usr/bin/security', ['find-identity', '-p', 'codesigning', keychain], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    assert(
      identities.includes(SIGNING_IDENTITY),
      'Signing Keychain does not contain the pinned identity',
    )
  }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.mkdirSync(output) // Never overwrite an earlier candidate.
  // electron-builder's ASAR unpack matcher requires sources below projectDir.
  const buildRoot = fs.mkdtempSync(path.join(project, 'dist', '.mac-build-'))
  let packagingStarted = false
  try {
    if (!unsigned && !originalKeychains.includes(keychain)) {
      run(
        '/usr/bin/security',
        ['list-keychains', '-d', 'user', '-s', ...originalKeychains, keychain],
        { stdio: 'pipe' },
      )
    }
    const compiled = path.join(buildRoot, 'out')
    run(process.execPath, [
      path.join(project, 'node_modules/electron-vite/bin/electron-vite.js'),
      'build',
      '--outDir',
      compiled,
    ])
    const compiledFiles = await Promise.all(
      fs
        .readdirSync(compiled, { recursive: true })
        .filter((file) => fs.statSync(path.join(compiled, file)).isFile())
        .sort()
        .map(async (file) => ({ file, sha512: await sha512(path.join(compiled, file)) })),
    )
    const base = yaml.load(fs.readFileSync(path.join(project, 'electron-builder.yml'), 'utf8'))
    const configuration = {
      ...base,
      extends: null,
      appId: APP_ID,
      directories: { ...base.directories, output },
      files: releaseFiles(compiled),
      compression: 'normal',
      extraMetadata: { meloMacNativeUpdates: !unsigned },
      artifactName: '${name}-${version}-${arch}.${ext}',
      forceCodeSigning: !unsigned,
      releaseInfo: { releaseNotes: fs.readFileSync(releaseNotes, 'utf8') },
      mac: {
        ...base.mac,
        identity: unsigned ? null : undefined,
        // Self-signed identities have no Apple Team ID. Keep the validated
        // non-hardened configuration; this is not Developer ID notarization.
        hardenedRuntime: false,
        notarize: false,
        ...(unsigned
          ? {}
          : {
              sign: async (options) => {
                await signAsync({
                  ...options,
                  identity: SIGNING_IDENTITY,
                  keychain,
                  identityValidation: false,
                  preAutoEntitlements: false,
                  optionsForFile: (file) => ({
                    ...options.optionsForFile(file),
                    hardenedRuntime: false,
                    timestamp: 'none',
                  }),
                })
                verifyApp(options.app, true, compiledFiles)
              },
            }),
      },
      dmg: { ...base.dmg, sign: false },
    }
    const { sign, ...mac } = configuration.mac
    const configurationFile = path.join(buildRoot, 'electron-builder.json')
    // A complete config file bypasses automatic loading/merging of the root
    // YAML. Negative globs alone do not override its reordered filesets.
    fs.writeFileSync(configurationFile, JSON.stringify({ ...configuration, mac }))
    packagingStarted = true
    await build({
      projectDir: project,
      targets: Platform.MAC.createTarget(
        ['dmg', 'zip'],
        ...architectures.map((arch) => Arch[arch]),
      ),
      publish: 'never',
      config: { extends: configurationFile, ...(sign ? { mac: { sign } } : {}) },
    })
    const files = await verifyArtifacts(output, architectures, !unsigned, compiledFiles)
    const artifacts = await Promise.all(
      files.map(async (file) => ({ file, sha512: await sha512(path.join(output, file)) })),
    )
    fs.writeFileSync(
      path.join(output, 'verified-release.json'),
      JSON.stringify(
        {
          version: packageInfo.version,
          identity: unsigned ? null : SIGNING_IDENTITY,
          architectures,
          compiledFiles,
          artifacts,
        },
        null,
        2,
      ) + '\n',
    )
    console.log(`Verified candidate: ${output}`)
  } finally {
    fs.rmSync(buildRoot, { recursive: true, force: true })
    if (!unsigned && !originalKeychains.includes(keychain)) {
      const current = keychains()
      run(
        '/usr/bin/security',
        ['list-keychains', '-d', 'user', '-s', ...current.filter((entry) => entry !== keychain)],
        { stdio: 'pipe' },
      )
    }
    // Cross-arch packaging rebuilds native modules in the working node_modules.
    // Restore the host binary so the next dev launch still works.
    if (packagingStarted) {
      await rebuild({
        buildPath: project,
        electronVersion: require('electron/package.json').version,
        arch: process.arch,
        onlyModules: ['better-sqlite3'],
        force: true,
      })
    }
  }
}

async function draftRelease() {
  const output = path.join(project, 'dist', `macos-${packageInfo.version}`)
  const report = JSON.parse(fs.readFileSync(path.join(output, 'verified-release.json'), 'utf8'))
  assert.equal(report.version, packageInfo.version)
  assert.equal(report.identity, SIGNING_IDENTITY)
  assert.deepEqual(report.architectures, ['arm64', 'x64'])
  assert(Array.isArray(report.compiledFiles) && report.compiledFiles.length > 0)
  const files = await verifyArtifacts(output, report.architectures, true, report.compiledFiles)
  assert.deepEqual(
    files,
    report.artifacts.map((entry) => entry.file),
  )
  for (const entry of report.artifacts) {
    assert.equal(await sha512(artifactPath(output, entry.file)), entry.sha512)
  }
  run('gh', [
    'release',
    'create',
    `v${packageInfo.version}`,
    '--repo',
    'melo-libs/melo',
    '--draft',
    '--title',
    `Melo ${packageInfo.version}`,
    '--notes-file',
    releaseNotes,
    ...files.map((file) => artifactPath(output, file)),
  ])
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.platform, 'darwin', 'macOS release commands must run on macOS')
  const [command, ...args] = process.argv.slice(2)
  if (command === 'build') await buildMac(args)
  else if (command === 'draft' && args.length === 0) await draftRelease()
  else
    throw new Error('Usage: node scripts/mac-release.mjs build [--unsigned] [--universal] | draft')
}
