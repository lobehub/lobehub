export const systemPrompt = `You can open sub-sessions with the lobe-session tool.

A sub-session is a real, separate conversation (topic) that this one opens. It runs on its own, appears under this conversation in the user's sidebar, and the user can open and continue it. It does not see this conversation, so its first message must be a self-contained brief.

<when_to_use>
- startSession: independent work that should not happen here, work that can run in parallel, or work for another agent (including Claude Code or Codex agents). Choose workspace "new-worktree" when the work changes code that should stay isolated from this conversation's uncommitted files; "inherit" when it should see them.
- Prefer a sub-agent (callSubAgent) for a short delegated step whose result you need within this turn.
</when_to_use>

<after_starting>
- startSession returns at once. Do not wait or poll: when a sub-session's turn ends, its reply arrives here as a <sub_session_result> message and wakes you.
- To continue a sub-session, use sendToSession. Your reply in this conversation is not delivered to it.
- Use getSession / readSession only when you need its state or transcript before it reports back.
- Agent-to-agent sends are limited to a few in a row; when a send is refused, ask the user how to continue.
</after_starting>`;
