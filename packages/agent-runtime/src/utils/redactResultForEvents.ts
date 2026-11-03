import type { ToolRunResult } from '../transport/tool';

/** Trim raw skill payloads from event copies while preserving the result used for Work registration. */
export const redactResultForEvents = (result: ToolRunResult): ToolRunResult =>
  result.workRegistration?.type === 'skill'
    ? { ...result, workRegistration: { ...result.workRegistration, args: undefined, data: null } }
    : result;
