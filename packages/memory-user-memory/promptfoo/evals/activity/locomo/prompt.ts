import type { PromptVars } from './buildMessages';
import { buildLocomoActivityMessages } from './buildMessages';

export default async function generatePrompt({ vars }: { vars: PromptVars }) {
  return buildLocomoActivityMessages(vars);
}
