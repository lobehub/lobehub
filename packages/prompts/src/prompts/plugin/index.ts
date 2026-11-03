import type { Tool } from './tools';
import { toolsPrompts } from './tools';

export const pluginPrompts = ({ tools }: { tools: Tool[] }) => {
  const content = toolsPrompts(tools);
  if (!content) return '';

  return `<tools description="The tools you can use below">
${content}
</tools>`;
};

export { type API, apiPrompt, type Tool, toolPrompt, toolsPrompts } from './tools';
