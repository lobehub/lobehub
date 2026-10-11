const content = `# lh goal - Long-Horizon Goal Graphs

A goal is a durable, agent-supervised unit of long-running work. It owns its own
task graph, dispatches those tasks to an executor agent, and is judged against a
standing requirement plus acceptance criteria — so it keeps making progress
across turns instead of ending when your turn does.

## When it applies

Creating a goal — and binding an existing one to a conversation — is gated to a
\`/goal\` run: the CLI only carries the \`goal:manage\` capability there, so an
ordinary run that tries anyway gets a permission error it must not work around.
Do not create a goal on your own initiative; if the user's ask is genuinely
long-horizon and should keep running past this turn, say so and tell them to send
\`/goal\`. Everything below is for a goal you are already supervising.

## Who is who

- **Goal agent** (\`--agent\`): supervises the goal — owns its list entry and page
  and runs every planning turn. Defaults to the current agent.
- **Task agent** (\`--task-agent\`): executes the goal's tasks. Defaults to the
  goal agent, so unless you deliberately split them there is only one agent.
- **You**: when you create a goal from a conversation, the goal is supervised
  from that conversation; you plan it, you do not do its tasks yourself.

## Subcommands

- \`lh goal create <title> [-r <requirement>] [-i <instruction>] [-t <task>...] [--criterion <text>...] [--topic] [--json]\` - Create a goal and seed its graph
  - \`--topic\` binds it to the current conversation (needs \`LOBEHUB_OPERATION_ID\`); omit it and the goal is standalone and never shows on the topic's goal tray
  - \`--criterion\` is repeatable; \`-t\` seeds initial tasks (omit to let the coordinator decompose)
  - The output carries \`goal.id\` and, for a \`--topic\` goal, a \`turnToken\` for the first plan
- \`lh goal list [--agent <id>] [--project <id>] [--status <status...>] [--limit <n>] [--json]\` - List goals with their graph roll-up
- \`lh goal show <id> [--json]\` - Show the goal and its graph (alias: \`graph\`)
- \`lh goal plan <id> --token <turnToken> --file <plan.json> [--json]\` - Submit the current main Agent plan (from a planning turn)
- \`lh goal report <id> --metadata-file <json> --content-file <report.md> [--operation <id>] [--json]\` - Submit the goal's wrap-up report
- \`lh goal run <id> [--max-ticks <n>] [--poll-ms <ms>] [--json]\` - Tick until the goal reaches a stop condition
- \`lh goal tick <id> [--json]\` - Advance exactly one coordinator step (for inspecting a single move)
- \`lh goal pause <id>\` / \`lh goal resume <id> [--confirm-exit]\` - Pause / resume coordination
- \`lh goal set-budget <id> [--max-rounds <n>] [--max-cost <usd>] [--max-manager-turns <n>] [--max-concurrent-tasks <n>] [--max-attempts-per-task <n>]\` - Edit the limits after creation ("none" removes a limit)
- \`lh goal set-requirement <id> -r <text> | --file <path>\` - Replace the requirement (what counts as done)
- \`lh goal set-agent <id> <agent>\` - Hand the goal to a different supervising agent
- \`lh goal set-task-agent <id> <agent|none>\` - Route the tasks to a dedicated executor; \`none\` hands them back to the goal agent
- \`lh goal bind-topic <id> [--force]\` - Attach an existing goal to the current conversation
- \`lh goal restart <id>\` - Start every unfinished task over (cancel stale runs, reset to backlog)
- \`lh goal decisions <id>\` / \`lh goal decide <id> <decision-id> --option <id> [--reason <text>]\` - List / resolve durable decision gates
- \`lh goal retire <id> <node-ids...>\` - Retire nodes that are no longer worth pursuing
- \`lh goal add-node <id> <kind> <title>\` / \`lh goal add-edge <id> <source> <target> <kind>\` - Extend the graph
- \`lh goal supervision <id>\` - Inspect recovery incidents, diagnostic topic and effective recovery rate
- \`lh goal wake <id> --token <token> --event <id> --type <type> --key <key> [--summary <text>] [--reference <ref>]\` - Deliver an external result to a goal waiting on it
- \`lh goal delete <id> [--yes]\` - Delete a goal and its graph

## Tips

- After the goal is created or bound with \`--topic\`, plan it in the SAME run and
  submit with \`lh goal plan <id> --token <turnToken> --file <plan.json>\`: the
  server adopts that run as the goal's first planning turn.
- Plan schema: \`{"action":"tasks","reason":"evidence-based rationale","tasks":[{"title":"specific task","description":"self-contained contract: inputs, output and acceptance"}]}\`
- Supervising is not doing: do not execute, preview or self-check the goal's
  tasks, mark them complete, change budgets, or claim it is achieved.
- The requirement is usually long and multi-line — edit it with
  \`lh goal set-requirement <id> --file <path>\` (or \`-r\` for a one-liner), not by
  rewriting the goal.
- Use \`--json\` for structured output suitable for piping.
`;

export default content;
