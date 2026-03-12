const content = `# lh skill - Skill Management

Manage agent skills (reusable prompt+resource bundles).

## Subcommands

- \`lh skill list [--source <builtin|market|user>]\` - List skills
- \`lh skill view <id>\` - View skill details
- \`lh skill create -n <name> -d <description> -c <content>\` - Create user skill
- \`lh skill edit <id> [-c <content>] [-n <name>] [-d <description>]\` - Update skill
- \`lh skill delete <id> [--yes]\` - Delete skill
- \`lh skill search <query>\` - Search skills
- \`lh skill install <source> [--branch <b>]\` - Install from GitHub/URL/marketplace
- \`lh skill resources <id>\` - List skill resource files
- \`lh skill read-resource <id> <path>\` - Read a skill resource file

## Tips

- Skills can be installed from GitHub repos, URLs, or the marketplace
- Use \`resources\` and \`read-resource\` to inspect skill reference files
`;

export default content;
