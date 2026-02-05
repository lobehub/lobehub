// @ts-expect-error - ignore ts error for .ts file import
import type { PromptVars } from './buildMessages';
import { buildActivityMessages } from './buildMessages.ts';

export default function generatePrompt({ vars }: { vars: PromptVars }) {
  return buildActivityMessages(vars);
}
