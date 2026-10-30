import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { build } from 'vite'
import { resolveConfig } from 'electron-vite'
import electron from 'electron'

const cache = path.resolve('node_modules/.cache')
await mkdir(cache, { recursive: true })
const output = await mkdtemp(path.join(cache, 'melo-agent-build-'))
try {
  const { config } = await resolveConfig({}, 'build')
  if (!config?.main) throw new Error('Missing main-process build configuration')
  await build({
    ...config.main,
    configFile: false,
    logLevel: 'error',
    build: {
      ...config.main.build,
      ssr: true,
      outDir: output,
      lib: {
        entry: {
          acp: path.resolve('src/main/agent/runtime/acpConnection.ts'),
          tools: path.resolve('src/main/agent/mcp/workspaceTools.ts'),
        },
        formats: ['cjs'],
      },
      rollupOptions: {
        ...config.main.build?.rollupOptions,
        output: { entryFileNames: '[name].cjs' },
      },
    },
  })
  const smoke = `
    const { AcpConnection } = require(process.argv[1]);
    const { startWorkspaceTools } = require(process.argv[2]);
    (async () => {
      const tools = await startWorkspaceTools(() => ({
        documents: {
          read: async () => { throw new Error('Unexpected document access'); },
          edit: async () => { throw new Error('Unexpected document access'); }
        }
      }));
      let connection;
      try {
        connection = await AcpConnection.start({
          launch: { command: process.execPath, args: [process.argv[3]] },
          workspaceRoot: process.argv[4], onUpdate: () => {}
        });
        await connection.createSession({ mcpServers: [tools.config] });
        await connection.prompt([{ type: 'text', text: 'build check' }]);
        console.log('Built ACP/MCP modules work in Electron Node ' + process.versions.node);
      } finally {
        await connection?.close();
        await tools.close();
      }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `
  const { stdout } = await promisify(execFile)(
    electron,
    [
      '-e',
      smoke,
      path.join(output, 'acp.cjs'),
      path.join(output, 'tools.cjs'),
      path.resolve('scripts/fixtures/agent-acp.mjs'),
      output,
    ],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 20_000 },
  )
  process.stdout.write(stdout)
} finally {
  await rm(output, { recursive: true, force: true })
}
