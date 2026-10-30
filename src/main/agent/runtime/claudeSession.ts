import type { McpServer, NewSessionRequest } from '@agentclientprotocol/sdk'

export const CLAUDE_ACP_VERSION = '0.95.0'

// Native write/exec tools stay unavailable; document mutations belong to Melo.
export function claudeSession(
  mcpServers: McpServer[],
  model?: string,
): Pick<NewSessionRequest, 'mcpServers' | '_meta'> {
  return {
    mcpServers,
    _meta: {
      claudeCode: {
        options: {
          ...(model ? { model } : {}),
          tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
          settingSources: [],
          strictMcpConfig: true,
          allowDangerouslySkipPermissions: false,
          persistSession: false,
          promptSuggestions: false,
          settings: { disableAllHooks: true },
        },
      },
    },
  }
}
