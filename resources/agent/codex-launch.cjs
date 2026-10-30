#!/usr/bin/env node
'use strict'

const { spawn } = require('node:child_process')
// This launch specification is supplied by Melo, never by workspace content.
const specification = JSON.parse(process.env.MELO_CODEX_LAUNCH)
// Codex validates transport before `enabled`. A partial enabled=false override
// can erase the transport variant, so supply an inert transport of the same kind.
const disabled = specification.servers.map(({ name, transport }) => {
  const fields =
    transport === 'stdio'
      ? `command=${JSON.stringify(specification.node)},args=["-e","process.exit(1)"]`
      : 'url="http://127.0.0.1:9"'
  return `${JSON.stringify(name)}={enabled=false,${fields}}`
})
const overrides = disabled.length ? ['-c', `mcp_servers={${disabled.join(',')}}`] : []
const child = spawn(
  specification.command,
  [
    ...specification.args,
    '--disable',
    'hooks',
    '--disable',
    'memories',
    '--disable',
    'plugins',
    '--disable',
    'apps',
    ...overrides,
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: process.env },
)
child.on('error', () => {
  console.error('Could not start Codex')
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
