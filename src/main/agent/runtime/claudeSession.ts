import type { McpServer, NewSessionRequest } from '@agentclientprotocol/sdk'
import { executionInstructions } from './executionInstructions'

export const CLAUDE_ACP_VERSION = '0.95.0'

export function claudeSession(
  mcpServers: McpServer[],
  workspaceRoot: string,
  model?: string,
  scratchDirectory?: string,
): Pick<NewSessionRequest, 'mcpServers' | '_meta'> {
  return {
    mcpServers,
    _meta: {
      claudeCode: {
        options: {
          ...(model ? { model } : {}),
          tools: { type: 'preset', preset: 'claude_code' },
          additionalDirectories: [workspaceRoot],
          settingSources: [],
          strictMcpConfig: true,
          allowDangerouslySkipPermissions: true,
          persistSession: false,
          promptSuggestions: false,
          ...(scratchDirectory && {
            systemPrompt: {
              type: 'preset',
              preset: 'claude_code',
              append: executionInstructions(workspaceRoot, scratchDirectory),
            },
          }),
          sandbox: { enabled: false },
          settings: {
            disableAllHooks: true,
          },
        },
      },
    },
  }
}
