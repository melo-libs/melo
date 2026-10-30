import { expect, it } from 'vitest'
import { ownedMcpTool } from './toolIdentity'

it('does not trust native tool inputs or a different MCP server', () => {
  expect(
    ownedMcpTool({ rawInput: { command: 'echo melo_edit_document' } }, 'codex', 'melo_123'),
  ).toBeNull()
  expect(
    ownedMcpTool(
      {
        _meta: { is_mcp_tool_call: true },
        rawInput: { server: 'other', tool: 'melo_edit_document' },
      },
      'codex',
      'melo_123',
    ),
  ).toBeNull()
  expect(
    ownedMcpTool(
      {
        _meta: { is_mcp_tool_call: true },
        rawInput: { server: 'melo_123', tool: 'melo_edit_document' },
      },
      'codex',
      'melo_123',
    ),
  ).toBe('melo_edit_document')
})
it('requires host-registered Claude MCP provenance and an exact tool allowlist', () => {
  const call = {
    _meta: {
      claudeCode: {
        toolName: 'mcp__melo_123__melo_read_document',
        mcpServer: { name: 'melo_123', source: 'sdk' },
      },
    },
  }
  expect(ownedMcpTool(call, 'claude', 'melo_123')).toBe('melo_read_document')
  const dynamic = {
    _meta: {
      claudeCode: { ...call._meta.claudeCode, mcpServer: { name: 'melo_123', source: 'dynamic' } },
    },
  }
  expect(ownedMcpTool(dynamic, 'claude', 'melo_123')).toBe('melo_read_document')
  expect(ownedMcpTool(dynamic, 'claude', 'melo_other')).toBeNull()
  expect(ownedMcpTool(call, 'claude', 'melo_other')).toBeNull()
  expect(
    ownedMcpTool(
      {
        _meta: {
          claudeCode: { ...call._meta.claudeCode, mcpServer: { name: 'melo_123', source: 'user' } },
        },
      },
      'claude',
      'melo_123',
    ),
  ).toBeNull()
})
