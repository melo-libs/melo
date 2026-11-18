export const APPROVAL_TIMEOUT_MS = 30 * 60_000

export class ApprovalUnavailableError extends Error {
  constructor(status: 'timed-out' | 'expired') {
    super(
      `${status === 'timed-out' ? 'User confirmation timed out' : 'User confirmation was interrupted'}. ` +
        'This operation was not approved and was not executed. Do not retry it or use another tool ' +
        'to make the change. Further requests requiring new approval are blocked for this turn; ' +
        'previously granted run approvals remain valid. Explain the result and wait for a new ' +
        'user message before requesting approval again.',
    )
    this.name = 'ApprovalUnavailableError'
  }
}
