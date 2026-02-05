import type { PromptVars } from './buildMessages';
import { buildIdentityDedupeMessages } from './buildMessages';

export default async function generatePrompt({ vars }: { vars: PromptVars }) {
  return buildIdentityDedupeMessages(vars);
}
