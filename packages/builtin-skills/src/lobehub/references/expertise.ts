const content = `# lh expertise - Self-Evolving Expertise

Read and write the domains an agent is bound to, the lessons it learned or was taught, and the rules filed in groups. Lessons and rules share ids.

## Choosing the target

- \`--agent <agentId>\` or \`--slug <slug>\` selects an agent. There is no implicit default.
- \`--domain <domainId>\` selects a domain. Given with an agent, it must be bound to that agent.
- A write that targets a domain needs exactly one. An agent with several domains fails and lists them.

## Subcommands

- \`lh expertise domains --agent <id>\` - List the agent's domains
- \`lh expertise lessons list --agent <id>\` - List active lessons (also \`--domain\`, \`--layer\`, \`--search\`)
- \`lh expertise lessons view <lessonId>\` - View a lesson or rule with its sections
- \`lh expertise lessons teach <text> --domain <id>\` - Teach one lesson, up to 2000 characters, sent unchanged
- \`lh expertise lessons revise <lessonId> <text>\` - Correct a lesson; replaces its limits section
- \`lh expertise lessons retire <lessonId> [--yes]\` - Stop practicing a lesson
- \`lh expertise lessons restore <lessonId>\` - Undo a retire; a merged rule cannot be restored
- \`lh expertise rules list [--agent <id>] [--domain <id>] [--include-retired]\` - List rules by group
- \`lh expertise rules create --title <title> --domain <id>\` - Write a rule (\`--why\`, \`--how\`, \`--limits\`, \`--enforcement\`, \`--direction\`, \`--compilability\`)
- \`lh expertise rules update <lessonId> [options]\` - Edit a rule; an empty section value clears it
- \`lh expertise rules reorder <lessonId> --domain <id> [--before <lessonId>]\` - Move within a group
- \`lh expertise rules move <lessonId> --domain <id>\` - File under another group; use the id it prints
- \`lh expertise rules merge <fromId> --into <lessonId> [--yes]\` - Fold one rule into another
- \`lh expertise ingest-history --agent <id> [--yes]\` - Learn from the agent's own past conversations

Read commands accept \`--json [fields]\`.
`;

export default content;
