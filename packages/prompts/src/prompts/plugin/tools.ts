export interface API {
  desc: string;
  name: string;
}
export interface Tool {
  apis: API[];
  identifier: string;
  name?: string;
  systemRole?: string;
}

export const apiPrompt = (api: API) => `<api identifier="${api.name}">${api.desc}</api>`;

export const toolPrompt = (tool: Tool) => {
  // Only emit <tool> if there's a systemRole (usage instructions).
  // API identifiers + descriptions are already in the tools schema,
  // so repeating them here wastes tokens.
  if (!tool.systemRole) return '';

  return `<tool name="${tool.name}">
<tool.instructions>${tool.systemRole}</tool.instructions>
</tool>`;
};

export const toolsPrompts = (tools: Tool[]) => {
  const hasTools = tools.length > 0;
  if (!hasTools) return '';

  return tools
    .map((tool) => toolPrompt(tool))
    .filter(Boolean)
    .join('\n');
};
