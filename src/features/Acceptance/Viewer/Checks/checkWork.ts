/**
 * The repair prompt points the agent at the CLI as the source of truth, so the
 * reviewer does not have to hand-summarize evidence and feedback. Shared with
 * the server, which sends the same prompt when a reject dispatches the repair.
 */
export { buildAcceptanceRepairPrompt as buildRepairPrompt } from '@lobechat/prompts';
