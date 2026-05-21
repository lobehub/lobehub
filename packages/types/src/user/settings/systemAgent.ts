import { z } from 'zod';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const UserSystemAgentConfigUpdateSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    for (const [key, item] of Object.entries(value)) {
      if (!isRecord(item)) continue;

      const hasModel = Object.hasOwn(item, 'model');
      const hasProvider = Object.hasOwn(item, 'provider');
      if (!hasModel && !hasProvider) continue;

      if (!hasModel || !hasProvider) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'System agent model and provider must be provided together',
          path: [key],
        });
        continue;
      }

      if (typeof item.model !== 'string' || !item.model) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'System agent model must be a non-empty string',
          path: [key, 'model'],
        });
      }

      if (typeof item.provider !== 'string' || !item.provider) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'System agent provider must be a non-empty string',
          path: [key, 'provider'],
        });
      }
    }
  });

export interface SystemAgentItem {
  customPrompt?: string;
  enabled?: boolean;
  model: string;
  provider: string;
}

export interface PromptRewriteSystemAgent extends Omit<SystemAgentItem, 'enabled'> {
  enabled: boolean;
}

export interface UserSystemAgentConfig {
  agentMeta: SystemAgentItem;
  generationTopic: SystemAgentItem;
  historyCompress: SystemAgentItem;
  inputCompletion: SystemAgentItem;
  promptRewrite: PromptRewriteSystemAgent;
  thread: SystemAgentItem;
  topic: SystemAgentItem;
  translation: SystemAgentItem;
}

export type UserSystemAgentConfigKey = keyof UserSystemAgentConfig;
