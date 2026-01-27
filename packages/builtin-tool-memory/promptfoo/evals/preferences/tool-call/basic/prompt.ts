// @ts-expect-error - ignore ts error for .ts file import
import { buildActivityMessages } from './buildMessages.ts';
import type { PromptVars } from './buildMessages';

export default function generatePrompt({ vars }: { vars: PromptVars }) {
  return buildActivityMessages(vars);
}
