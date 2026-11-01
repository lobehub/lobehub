const content = `# lh agent-group / lh session-group - Agent Groups and Sidebar Folders

Two different "groups":

- **Agent group** (\`lh agent-group\`): several agents that work together in one group chat.
- **Session group** (\`lh session-group\`): a folder that organizes agents in the sidebar. It has no behavior.

## Agent groups

- \`lh agent-group list [--json]\` - List agent groups
- \`lh agent-group view <id> [--json]\` - View a group and its members
- \`lh agent-group create -t <title> [-d <description>] [--json]\` - Create a group
- \`lh agent-group edit <id> [-t <title>] [-d <description>]\` - Update a group
- \`lh agent-group duplicate <id> [-t <title>]\` - Duplicate a group
- \`lh agent-group add-agents <groupId> --agent-ids <id1,id2>\` - Add agents
- \`lh agent-group remove-agents <groupId> --agent-ids <id1,id2> [--keep-virtual] [--yes]\` - Remove agents
- \`lh agent-group delete <id> [--yes]\` - Delete a group

## Session groups (sidebar folders)

- \`lh session-group list [--json]\` - List folders
- \`lh session-group create -n <name> [-s <sort>]\` - Create a folder
- \`lh session-group edit <id> [-n <name>] [-s <sort>]\` - Rename or reorder a folder
- \`lh session-group sort --map "id1:0,id2:1"\` - Reorder several folders at once
- \`lh session-group delete <id> [--yes]\` - Delete a folder

## Tips

- \`remove-agents\` deletes virtual agents (ones that exist only inside the group) unless \`--keep-virtual\` is set
`;

export default content;
