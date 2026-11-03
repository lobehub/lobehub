const content = `# lh project / lh task - Projects and Tasks

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

- \`lh task list [--root] [--parent <id>] [--agent <id>] [--tree] [--board] [-L <n>] [--json]\` - List tasks
- \`lh task view <id> [--json]\` - View a task (instruction, documents, activities)
- \`lh task create -i <instruction> [-n <name>] [--agent <id>] [--user <idOrEmail>] [--parent <id>] [--priority <0-4>]\` - Create a task
- \`lh task edit <id> [-n <name>] [-i <instruction>] [--agent <id>] [--user <idOrEmail>] [--priority <0-4>]\` - Edit a task
- \`lh task comment <id> -m <text>\` - Add a progress comment

When you are executing a task run, the \`task\` skill covers the full lifecycle
(subtasks, dependencies, task documents, completion rules). Activate it instead of
guessing. \`lh man task\` lists every subcommand.

## Tips

- \`--user\` takes an email or username only in a workspace scope (see \`references/workspace\`). In personal scope it needs a \`user_…\` id
- Priority: 0 none, 1 urgent, 2 high, 3 normal, 4 low
`;

export default content;
