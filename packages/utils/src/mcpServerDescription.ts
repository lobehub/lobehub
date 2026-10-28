interface McpServerCapabilities {
  prompts?: readonly unknown[];
  resources?: readonly unknown[];
  tools?: readonly { name: string }[];
}

/** Persisted MCP metadata, also consumed by model prompts. Keep this text in English. */
export const getMcpServerDescription = (
  identifier: string,
  { prompts, resources, tools }: McpServerCapabilities,
  { includeToolExample = false }: { includeToolExample?: boolean } = {},
): string => {
  const counts = [
    { count: prompts?.length, name: 'prompt' },
    { count: resources?.length, name: 'resource' },
    { count: tools?.length, name: 'tool' },
  ];
  const summary = counts
    .filter(({ count }) => count)
    .map(({ count, name }) => `${count} ${name}${count === 1 ? '' : 's'}`)
    .join(', ');
  const example = includeToolExample && tools?.[0] ? `, like ${JSON.stringify(tools[0].name)}` : '';

  return `${identifier} MCP server has ${summary || 'no tools, prompts, or resources'}${example}`;
};
