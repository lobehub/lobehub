const content = `# lh kb - Knowledge Base Management

Manage knowledge bases, folders, documents, and files.

## Subcommands

- \`lh kb list\` - List all knowledge bases
- \`lh kb view <id>\` - View KB with all items in tree structure
- \`lh kb create -n <name> [-d <description>]\` - Create a knowledge base
- \`lh kb edit <id> [-n <name>] [-d <description>]\` - Update KB metadata
- \`lh kb delete <id> [--remove-files] [--yes]\` - Delete a knowledge base
- \`lh kb add-files <kbId> --ids <fileId1,fileId2>\` - Add files to KB
- \`lh kb remove-files <kbId> --ids <fileId1,fileId2>\` - Remove files from KB
- \`lh kb mkdir <kbId> -n <name> [--parent <folderId>]\` - Create a folder
- \`lh kb create-doc <kbId> -t <title> -c <content> [--parent <folderId>]\` - Create a document in KB
- \`lh kb move <id> --parent <folderId> --type <file|doc>\` - Move file/document to folder
- \`lh kb upload <kbId> <filePath> [--parent <folderId>]\` - Upload file to KB

## Tips

- Use \`--json\` on any subcommand for structured output
- \`lh kb view\` shows a full tree of folders, files, and documents
- After uploading a file, use \`lh doc parse <fileId>\` to extract text content
`;

export default content;
