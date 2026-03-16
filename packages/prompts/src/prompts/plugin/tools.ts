export interface API {
  desc: string;
  name: string;
}
export interface Tool {
  apis: API[];
  description?: string;
  identifier: string;
  name?: string;
  systemRole?: string;
}

export const apiPrompt = (api: API) => `<api identifier="${api.name}">${api.desc}</api>`;

export const toolPrompt = (tool: Tool) => {
  if (tool.systemRole) {
    return `<tool name="${tool.name}">
<tool.instructions>${tool.systemRole}</tool.instructions>
</tool>`;
  }

  return `<tool name="${tool.name}">${tool.description || 'no description'}</tool>`;
};

export const toolsPrompts = (tools: Tool[]) => {
  const hasTools = tools.length > 0;
  if (!hasTools) return '';

  return tools.map((tool) => toolPrompt(tool)).join('\n');
};
