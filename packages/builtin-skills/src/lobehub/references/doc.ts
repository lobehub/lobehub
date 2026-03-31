const content = `# lh doc - Document Management

Manage documents (text content that can be standalone or in knowledge bases).

## Subcommands

- \`lh doc list [-L <limit>] [--file-type <type>] [--source-type <type>]\` - List documents
- \`lh doc view <id>\` - View document content
- \`lh doc create -t <title> -b <body> [--kb <kbId>] [--parent <folderId>]\` - Create document
- \`lh doc batch-create <jsonFile>\` - Batch create documents from JSON file
- \`lh doc edit <id> [-t <title>] [-b <body>]\` - Edit document
- \`lh doc delete <ids...> [--yes]\` - Delete documents
- \`lh doc parse <fileId> [--with-pages]\` - Parse uploaded file into document
- \`lh doc link-topic <docId> <topicId>\` - Associate document with topic
- \`lh doc topic-docs <topicId> [--type <type>]\` - List documents for a topic

## Tips

- Use \`-F <filePath>\` instead of \`-b\` to read body content from a file
- \`lh doc parse\` extracts text from uploaded files (PDF, DOCX, etc.)
`;

export default content;
