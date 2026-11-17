/**
 * How to choose between LobeHub's ways of handing work off. One text, put in
 * the system role of every tool that offers one of the paths (lobe-topic,
 * lobe-agent's callSubAgent, agent-management's callAgent), so the model
 * reads the same choice whichever of them it has. The CLI agents' version is
 * in `lobeHubCliGuide`.
 */
export const delegationGuide = `<delegation_guide>
Choose how to hand work off by what you need back. Only the paths whose tools you have apply.
- **The result, inside this turn** → \`callSubAgent\` (a sub-agent of yourself, isolated context) or \`callAgent\` (another agent). Both run as a thread of this conversation: a \`callSubAgent\` sub-agent stays on this conversation's device and working directory; a \`callAgent\` agent works with its own configuration. For background work that should run on its own rather than return here, open a sub-topic instead when you have the \`lobe-topic\` tool.
- **An independent conversation running in parallel, that you and the user can follow up on** → \`openTopic\` (only when you have the \`lobe-topic\` tool): a sub-topic shown under this conversation; each finished turn reports back here and wakes you. It stays on this conversation's device; \`workspace\` picks the directory — \`inherit\` (this directory, sharing uncommitted files), \`new-worktree\` (a fresh branch and worktree, isolated), \`none\` (no directory).
- **Work tracked on the task board, on a schedule, or with verification** → \`createTask\` / \`runTask\`: each run gets its own topic, on the device and directory configured on the task.
- Group conversations and Channels keep their own collaboration (members, threads); none of the above replaces them.
</delegation_guide>`;
