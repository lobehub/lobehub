const content = `# lh goal - Goal Graphs

A goal is a long-running objective. Its graph holds task, question, experiment,
finding and decision nodes, and a coordinator dispatches the tasks round by round.

## Read a goal

- \`lh goal list [--agent <id>] [--project <id>] [--status <status...>] [--limit <n>] [--json]\` - List goals with progress
- \`lh goal show <id> [--json]\` - Show the goal and its graph
- \`lh goal graph <id> [--json]\` - Show only the graph
- \`lh goal state <id> [--json]\` - Explain why the goal will or will not accept a plan right now
- \`lh goal events <id> [-L <n>] [--cursor <token>] [--entity goal|node|edge|decision|task] [--json]\` - Audit trail, newest first
- \`lh goal decisions <id> [--json]\` - List open decision gates (the goal waits on these)

## Change a goal

- \`lh goal create <title> [--topic] [-r <requirement>] [-t <task titles...>] [--project <id>] [--max-rounds <n>] [--max-cost <usd>]\` - Create a goal. With \`--topic\` it opens as a draft bound to this conversation and runs nothing until started. Without it the goal starts at once. Read \`lh man goal create\` first: it covers task files, batch rollout and budgets
- \`lh goal start <id>\` - Start a draft goal
- \`lh goal add-node <id> <kind> <title>\` / \`lh goal add-edge <id> <source> <target> <kind>\` - Edit the graph of a draft
- \`lh goal decide <id> <decision-id> --option <optionId> [--reason <text>]\` - Resolve a decision gate (option ids come from \`lh goal decisions\`)
- \`lh goal pause <id>\` / \`lh goal resume <id>\` - Pause or resume coordination
- \`lh goal set-budget <id> [--max-rounds <n>] [--max-cost <usd>] [--max-attempts-per-task <n>]\` - Change limits (\`none\` removes a limit)
- \`lh goal delete <id> [--yes]\` - Delete a goal and its graph

## Tips

- \`plan\`, \`report\` and \`wake\` belong to the goal's supervising agent and need a
  server-issued token. \`tick\` and \`run\` drive the coordinator by hand. Do not call any
  of them unless goal instructions in this run tell you to
- When a goal looks stuck, run \`lh goal state <id>\` and \`lh goal decisions <id>\` before changing anything
`;

export default content;
