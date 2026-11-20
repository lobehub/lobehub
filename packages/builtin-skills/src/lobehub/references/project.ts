const content = `# lh project - Projects

A project groups tasks, agents and knowledge bases around one outcome. Tasks are
units of agent work with an identifier such as \`T-12\`.

## Projects

- \`lh project list [--status <statuses...>] [--json]\` - List projects
- \`lh project view <id> [--json]\` - View project detail
- \`lh project create -n <name> [-i <identifierPrefix>] [-d <desc>] [--slug <slug>] [--visibility <v>]\` - Create a project (optional \`-i\` replaces the task prefix, e.g. \`ACE\`; omit it to keep the default prefix)
- \`lh project edit <id> [-n <name>] [-d <desc>] [--slug <slug>] [--visibility <v>]\` - Edit a project
- \`lh project status <id> <status>\` - Set backlog / active / paused / canceled / archived
- \`lh project request-review <id>\` / \`accept <id> [-m <comment>]\` / \`reject <id> -m <feedback>\` / \`reopen <id>\` - Review flow (\`reviewing\` / \`completed\` go through these)
- \`lh project agent add <projectId> <agentId> [--role <role>] [--responsibility <text>]\` / \`agent remove <projectId> <agentId>\`
- \`lh project kb add <projectId> <kbId>\` / \`kb remove <projectId> <kbId>\`
- \`lh project task create <projectId> -i <instruction> [-n <name>] [--agent <agentId>] [--parent <taskId>]\` - Create a task in the project
- \`lh project delete <id> [--yes]\` - Delete a project (its tasks are kept, without a project)

## Tasks
See \`references/task\` for task commands and \`lh man task\` for the CLI manual.

`;

export default content;
