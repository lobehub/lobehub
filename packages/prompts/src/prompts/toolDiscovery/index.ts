export interface AvailableToolItem {
  description: string;
  identifier: string;
  name: string;
}

export const availableToolPrompt = (tool: AvailableToolItem) =>
  `  <tool identifier="${tool.identifier}" name="${tool.name}">${tool.description}</tool>`;

export const availableToolsPrompts = (tools: AvailableToolItem[]) => {
  if (tools.length === 0) return '';

  const toolTags = tools.map((tool) => availableToolPrompt(tool)).join('\n');

  return `<available_tools description="These tools are installed but not yet enabled. Use activateTools to enable them when needed.">\n${toolTags}\n</available_tools>`;
};
