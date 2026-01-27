import { buildActivityMessages, PromptVars } from './buildMessages';

export default function generatePrompt({ vars }: { vars: PromptVars }) {
  return buildActivityMessages(vars);
}
