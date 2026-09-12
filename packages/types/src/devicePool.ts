import { z } from 'zod';

/** Built-in policy subjects. Future identity providers add subject matching at the evaluator boundary. */
export const devicePoolSubjects = ['everyone', 'workspaceMember'] as const;
/** Entry classes used for device authorization, independent of topic creation. */
export const devicePoolTriggers = ['chat', 'bot', 'task'] as const;
/** Three-state values; inherit does not decide at its own layer. */
export const devicePoolEffects = ['deny', 'inherit', 'allow'] as const;
/** Supported built-in authorization subject. */
export type DevicePoolSubject = (typeof devicePoolSubjects)[number] | `user:${string}`;
/** Original entry class of a run. */
export type DevicePoolTrigger = (typeof devicePoolTriggers)[number];
/** Explicit decision or fallback to another applicable rule. */
export type DevicePoolEffect = (typeof devicePoolEffects)[number];

/** One trigger's subject-specific settings. Absent subjects inherit. */
export const devicePoolRuleSchema = z.record(
  z.union([z.enum(devicePoolSubjects), z.string().startsWith('user:').min(6)]),
  z.enum(devicePoolEffects),
);
/** Sparse trigger matrix, shared by default policies and Agent overrides. */
export const devicePoolMatrixSchema = z
  .object({
    bot: devicePoolRuleSchema.optional(),
    chat: devicePoolRuleSchema.optional(),
    task: devicePoolRuleSchema.optional(),
  })
  .strict();
/** Persisted pool policy with a default and non-overridable trigger restrictions. */
export const devicePoolPolicySchema = z
  .object({
    blockedTriggers: z.array(z.enum(devicePoolTriggers)).max(3),
    everyone: z.enum(devicePoolEffects),
    rules: devicePoolMatrixSchema,
  })
  .strict();
/** Per-trigger rules, with identity-specific cells. */
export type DevicePoolMatrix = z.infer<typeof devicePoolMatrixSchema>;
/** Policy stored on a pool. */
export type DevicePoolPolicy = z.infer<typeof devicePoolPolicySchema>;

/** Server-authored provenance; it never comes from tool arguments or public request input. */
export const devicePoolRunContextSchema = z
  .object({
    actorUserId: z.string().optional(),
    agentId: z.string(),
    blocked: z.boolean(),
    trigger: z.enum(devicePoolTriggers),
    workspaceId: z.string().optional(),
  })
  .strict();
/** Authorization identity preserved through a run's descendants. */
export type DevicePoolRunContext = z.infer<typeof devicePoolRunContextSchema>;

/** Explains the single rule responsible for one pool decision. */
export interface DevicePoolDecision {
  /** Whether this pool supplies a complete authorization path. */
  allowed: boolean;
  /** Origin of the decision; useful for previews and audit records. */
  source: 'hard-limit' | 'agent-override' | 'pool-rule' | 'pool-default' | 'system-default';
  /** Matched built-in identity, absent for hard restrictions and system fallback. */
  subject?: DevicePoolSubject;
}
