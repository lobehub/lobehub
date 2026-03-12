const content = `# lh search - Search Resources

Search local resources or the web.

## Subcommands

- \`lh search -q <query> [-t <type>] [-L <limit>]\` - Search local resources
- \`lh search -q <query> -w [-e <engines>] [-c <categories>]\` - Search the web
- \`lh search view <target>\` - View search result details or crawl a URL

## Search Types (local)

agent, topic, file, folder, message, page, memory, mcp, plugin, communityAgent, knowledgeBase

## Tips

- Use \`-w\` flag to perform web search instead of local search
- \`lh search view <url>\` can crawl and extract content from web pages
- Web search supports engine and category filters
`;

export default content;
