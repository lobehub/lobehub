import { z } from 'zod';

export const agentHookTypeSchema = z.enum([
  'beforeStep',
  'afterStep',
  'onComplete',
  'onError',
  'beforeToolCall',
  'afterToolCall',
  'onToolCallError',
  'beforeHumanIntervention',
  'afterHumanIntervention',
  'onStopByHumanIntervention',
  'beforeCompact',
  'afterCompact',
  'onCompactError',
  'beforeCallAgent',
  'afterCallAgent',
  'onCallAgentError',
]);

/** Regex against `${identifier}/${apiName}`; omitted, empty or * matches every tool. */
export const agentHookMatcherSchema = z.string().refine((pattern) => {
  if (!pattern || pattern === '*') return true;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}, 'Invalid hook matcher regular expression');

/** Persist templates only; environment values are resolved immediately before sending. */
export const agentHookWebhookSchema = z
  .strictObject({
    allowedEnvVars: z.array(z.string().regex(/^[A-Z_]\w*$/i)).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    delivery: z.enum(['fetch', 'qstash']).optional(),
    eventFields: z.array(z.string()).optional(),
    fallback: z.enum(['fetch', 'none']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    onError: z.enum(['continue', 'block']).optional(),
    responseHandling: z.enum(['ignore', 'toolCall']).optional(),
    timeout: z.number().positive().max(2_147_483.647).optional(),
    url: z
      .string()
      .min(1)
      .refine((value) => {
        if (value.includes('\\')) return false;
        if (value.startsWith('/') && !value.startsWith('//')) return true;
        try {
          const url = new URL(value);
          return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
        } catch {
          return false;
        }
      }, 'Webhook URL must be HTTP(S) or an application-relative path without credentials'),
  })
  .superRefine((webhook, ctx) => {
    const control = webhook.responseHandling === 'toolCall';
    if (control && webhook.delivery === 'qstash') {
      ctx.addIssue({
        code: 'custom',
        message: 'toolCall response handling requires fetch delivery',
      });
    }
    if (!control && webhook.onError === 'block') {
      ctx.addIssue({
        code: 'custom',
        message: 'onError:block requires toolCall response handling',
      });
    }
    if (control && (webhook.eventFields !== undefined || webhook.body !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Control hooks cannot filter or override the event payload',
      });
    }
  });

export const serializedAgentHookSchema = z
  .strictObject({
    id: z.string(),
    matcher: agentHookMatcherSchema.optional(),
    type: agentHookTypeSchema,
    webhook: agentHookWebhookSchema,
  })
  .superRefine((hook, ctx) => {
    if (
      hook.matcher !== undefined &&
      !['beforeToolCall', 'afterToolCall', 'onToolCallError'].includes(hook.type)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Matchers are only supported for tool events' });
    }
    if (hook.webhook.responseHandling === 'toolCall' && hook.type !== 'beforeToolCall') {
      ctx.addIssue({
        code: 'custom',
        message: 'toolCall response handling requires beforeToolCall',
      });
    }
  });

export type AgentHookMatcher = z.infer<typeof agentHookMatcherSchema>;
export type AgentHookWebhookConfig = z.infer<typeof agentHookWebhookSchema>;
export type SerializedAgentHook = z.infer<typeof serializedAgentHookSchema>;
