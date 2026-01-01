import { buildIdentityDedupeMessages, PromptVars } from './buildMessages';

export default async function generatePrompt({ vars }: { vars: PromptVars }) {
  return buildIdentityDedupeMessages(vars);
}
