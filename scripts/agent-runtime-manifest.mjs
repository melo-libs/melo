// Run deliberately when upgrading the adapters, then review and commit the manifest.
import { writeFile } from 'node:fs/promises'
const nodeVersion = '24.14.0'
const claudeVersion = '0.3.309'
const codexVersion = '0.160.1'
const checksums = await (
  await fetch(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`)
).text()
const manifest = {}
for (const platform of ['darwin', 'linux']) {
  for (const arch of ['arm64', 'x64']) {
    const target = `${platform}-${arch}`
    const nodeName = `node-v${nodeVersion}-${target}.tar.gz`
    const nodeUrl = `https://nodejs.org/dist/v${nodeVersion}/${nodeName}`
    const nodeHead = await fetch(nodeUrl, { method: 'HEAD' })
    if (!nodeHead.ok) throw new Error(nodeUrl)
    const sha = checksums
      .split('\n')
      .find((line) => line.endsWith(`  ${nodeName}`))
      ?.split(' ')[0]
    if (!sha) throw new Error(`Missing checksum: ${target}`)
    const packages = {}
    for (const provider of ['claude', 'codex']) {
      const name =
        provider === 'claude' ? `@anthropic-ai/claude-agent-sdk-${target}` : '@openai/codex'
      const version = provider === 'claude' ? claudeVersion : `${codexVersion}-${target}`
      const response = await fetch(`https://registry.npmjs.org/${name}/${version}`)
      if (!response.ok) throw new Error(`${name}@${version}`)
      const { dist } = await response.json()
      const head = await fetch(dist.tarball, { method: 'HEAD' })
      // Registry responses can be chunked: stream once to measure the exact archive size.
      let bytes = Number(head.headers.get('content-length'))
      if (!bytes) {
        const archive = await fetch(dist.tarball)
        if (!archive.ok) throw new Error(dist.tarball)
        for await (const chunk of archive.body) bytes += chunk.length
      }
      const triple =
        platform === 'darwin'
          ? `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
          : `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`
      packages[provider] = {
        version: provider === 'claude' ? '2.1.309' : codexVersion,
        url: dist.tarball,
        integrity: dist.integrity,
        bytes,
        executable: provider === 'claude' ? 'claude' : `vendor/${triple}/bin/codex`,
      }
    }
    manifest[target] = {
      node: {
        version: nodeVersion,
        url: nodeUrl,
        integrity: `sha256-${Buffer.from(sha, 'hex').toString('base64')}`,
        bytes: Number(nodeHead.headers.get('content-length')),
        executable: 'bin/node',
      },
      ...packages,
    }
  }
}
await writeFile(
  'src/main/agent/runtime/runtimeManifest.json',
  JSON.stringify(manifest, null, 2) + '\n',
)
