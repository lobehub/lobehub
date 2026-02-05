import type { Tool } from './tools';
import { toolsPrompts } from './tools';

export const pluginPrompts = ({ tools }: { tools: Tool[] }) => {
  const prompt = `<plugins description="The plugins you can use below">
${toolsPrompts(tools)}
</plugins>`;

  return prompt.trim();
};

export { type API, apiPrompt, type Tool, toolPrompt, toolsPrompts } from './tools';
