import { agentHookTypeSchema, agentHookWebhookSchema } from '@lobechat/types';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/** Server-only deployment hooks. Secrets are validated here, never copied into hook state. */
export const getAgentHookConfig = () => {
  const env = createEnv({
    onValidationError: (issues) => {
      // Do not log Zod inputs or environment values (especially the token).
      throw new Error(
        `Invalid Agent Hook environment: ${issues.map((issue) => issue.path?.join('.')).join(', ')}`,
      );
    },
    runtimeEnv: {
      AGENT_HOOK_WEBHOOK_EVENTS: process.env.AGENT_HOOK_WEBHOOK_EVENTS,
      AGENT_HOOK_WEBHOOK_ON_ERROR: process.env.AGENT_HOOK_WEBHOOK_ON_ERROR,
      AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING: process.env.AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING,
      AGENT_HOOK_WEBHOOK_TOKEN: process.env.AGENT_HOOK_WEBHOOK_TOKEN,
      AGENT_HOOK_WEBHOOK_URL: process.env.AGENT_HOOK_WEBHOOK_URL,
    },
    server: {
      AGENT_HOOK_WEBHOOK_EVENTS: z.preprocess(
        (value) =>
          typeof value === 'string'
            ? [
                ...new Set(
                  value
                    .split(',')
                    .map((event) => event.trim())
                    .filter(Boolean),
                ),
              ]
            : value,
        z.array(agentHookTypeSchema).min(1).optional(),
      ),
      AGENT_HOOK_WEBHOOK_ON_ERROR: z.enum(['continue', 'block']).default('continue'),
      AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING: z.enum(['ignore', 'toolCall']).default('ignore'),
      AGENT_HOOK_WEBHOOK_TOKEN: z
        .string()
        .refine((token) => token.trim().length > 0)
        .optional(),
      AGENT_HOOK_WEBHOOK_URL: agentHookWebhookSchema.shape.url.optional(),
    },
  });

  if (env.AGENT_HOOK_WEBHOOK_URL !== undefined) {
    if (!env.AGENT_HOOK_WEBHOOK_TOKEN)
      throw new Error('AGENT_HOOK_WEBHOOK_URL requires non-empty AGENT_HOOK_WEBHOOK_TOKEN');
    if (!env.AGENT_HOOK_WEBHOOK_EVENTS?.length)
      throw new Error('AGENT_HOOK_WEBHOOK_URL requires non-empty AGENT_HOOK_WEBHOOK_EVENTS');
  }
  if (
    env.AGENT_HOOK_WEBHOOK_ON_ERROR === 'block' &&
    env.AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING !== 'toolCall'
  )
    throw new Error(
      'AGENT_HOOK_WEBHOOK_ON_ERROR=block requires AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING=toolCall',
    );
  if (
    env.AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING === 'toolCall' &&
    !env.AGENT_HOOK_WEBHOOK_EVENTS?.includes('beforeToolCall')
  )
    throw new Error(
      'AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING=toolCall requires beforeToolCall in AGENT_HOOK_WEBHOOK_EVENTS',
    );
  return env;
};
