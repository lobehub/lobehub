const content = `# lh file - File Management

Manage uploaded files.

## Subcommands

- \`lh file list [--kb-id <id>] [-L <limit>]\` - List files (optionally filter by knowledge base)
- \`lh file view <id>\` - View file details
- \`lh file delete <ids...> [--yes]\` - Delete one or more files
- \`lh file recent [-L <limit>]\` - List recently accessed files

## Tips

- Files can be associated with knowledge bases
- Use \`lh kb upload\` to upload new files to a knowledge base
`;

export default content;
