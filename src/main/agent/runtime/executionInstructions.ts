// These belong to the host/Harness, not to programs inspecting user attachments.
export const EXECUTION_SECRET_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'MELO_CODEX_API_KEY',
  'CODEX_CONFIG',
  'MELO_CODEX_LAUNCH',
]

export function executionInstructions(workspaceRoot: string, scratchDirectory: string): string {
  return `Your working directory is the user's Melo workspace: ${workspaceRoot}. Use native tools to read attachments, analyze content, run commands and access the network as needed for the user's task. Put scripts, extracted text, conversions and other intermediate results in ${scratchDirectory} or the current $TMPDIR. Use Melo MCP for capabilities Melo provides, including workspace file creation, editing, renaming, moving, deletion, memory and the latest Markdown editor content. These tools preserve user confirmation, revision checks and undo. Never work around a declined Melo operation using native tools. Do not change the user's Harness settings or account credentials. Do not reuse temporary paths from another process.`
}
