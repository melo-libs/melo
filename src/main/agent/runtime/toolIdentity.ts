import { agentTool, type AgentToolName } from '../../../shared/agentCapabilities'
import type { ToolCallUpdate } from '@agentclientprotocol/sdk'
import { z } from 'zod'
import type { AgentProvider } from '../../../shared/types/agent'

const CLAUDE_META = z.object({
  claudeCode: z.object({
    toolName: z.string(),
    mcpServer: z.object({ name: z.string(), source: z.enum(['sdk', 'dynamic']) }),
  }),
})
const CODEX_META = z.object({ is_mcp_tool_call: z.literal(true) })
const CODEX_INPUT = z.object({ server: z.string(), tool: z.string() })

/** Adapter-provided provenance, not a model-authored display title, grants
 * access to the owned server. The random server name is scoped to one runtime. */
export function ownedMcpTool(
  call: Pick<ToolCallUpdate, '_meta' | 'rawInput'>,
  provider: AgentProvider,
  server: string,
): AgentToolName | null {
  if (provider === 'claude') {
    // ACP HTTP/stdio servers use "dynamic"; "sdk" denotes in-process ones.
    // strictMcpConfig and the fresh per-runtime name exclude configured servers.
    const parsed = CLAUDE_META.safeParse(call._meta)
    if (!parsed.success || parsed.data.claudeCode.mcpServer.name !== server) return null
    const prefix = `mcp__${server}__`
    const name = parsed.data.claudeCode.toolName
    if (!name.startsWith(prefix)) return null
    const tool = name.slice(prefix.length)
    return agentTool(tool)?.name ?? null
  }
  const input = CODEX_INPUT.safeParse(call.rawInput)
  if (!CODEX_META.safeParse(call._meta).success || !input.success || input.data.server !== server)
    return null
  return agentTool(input.data.tool)?.name ?? null
}
