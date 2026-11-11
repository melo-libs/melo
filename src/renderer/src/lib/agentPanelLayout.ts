export const AGENT_DOCK_MIN = 360
export const AGENT_DOCK_MAX = 600
export const AGENT_DOCK_DEFAULT = 420
export const AGENT_DOCK_EDGE = 32

export type AgentPanelMode = 'floating' | 'docked'

/** Return zero when docking would squeeze the document below its minimum width. */
export function agentDockWidth(preferred: number, available: number): number {
  if (available < AGENT_DOCK_MIN) return 0
  return Math.round(
    Math.min(
      AGENT_DOCK_MAX,
      available,
      Math.max(AGENT_DOCK_MIN, Number.isFinite(preferred) ? preferred : AGENT_DOCK_DEFAULT),
    ),
  )
}
