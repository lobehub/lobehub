import { delegationGuide } from './delegationGuide';

export const systemPrompt = `You can open sub-topics with the lobe-topic tool.

A sub-topic is a real, separate conversation (topic) that this one opens. It runs on its own, appears under this conversation in the user's sidebar, and the user can open and continue it. It does not see this conversation, so its first message must be a self-contained brief.

<when_to_use>
- openTopic: independent work that should not happen here, work that can run in parallel, or work for another agent (including Claude Code or Codex agents). Choose workspace "new-worktree" when the work changes code that should stay isolated from this conversation's uncommitted files; "inherit" when it should see them.
- Prefer a sub-agent (callSubAgent) for a short delegated step whose result you need within this turn.
</when_to_use>

<after_starting>
- openTopic returns at once. Do not wait or poll: when a sub-topic's turn ends, its reply arrives here as a <sub_topic_result> message and wakes you.
- To continue a sub-topic, use sendToTopic. Your reply in this conversation is not delivered to it.
- Use getTopic / readTopic only when you need its state or transcript before it reports back.
- Agent-to-agent sends are limited to a few in a row; when a send is refused, ask the user how to continue.
</after_starting>

${delegationGuide}`;
