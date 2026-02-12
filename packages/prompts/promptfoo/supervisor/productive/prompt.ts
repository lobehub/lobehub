// TypeScript prompt wrapper that uses actual buildSupervisorPrompt implementation
import type { SupervisorPromptParams } from '../../../src';
import { buildSupervisorPrompt } from '../../../src';

const generatePrompt = ({
  vars,
}: {
  vars: Omit<SupervisorPromptParams, 'allowDM' | 'scene'> & { role: string };
}) => {
  const prompt = buildSupervisorPrompt(vars);

  // Return messages and tools for promptfoo
  // Note: tools must be at top level for is-valid-openai-tools-call assertion to work
  // The assertion reads from provider.config.tools, and promptfoo merges top-level
  // properties into provider config
  return [{ content: prompt, role: vars.role || 'user' }];
};

export default generatePrompt;
