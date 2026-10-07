import { z } from 'zod';

/** Separate RPC version: older connectors must reject rather than run with native auth. */
export const PROVIDER_BOUND_AGENT_RUN_METHOD = 'dispatchProviderBoundAgentRun';

/** Credential-free reference and operation-scoped callback data for a personal Codex run. */
export const ProviderBoundAgentRunSchema = z
  .object({
    agentType: z.literal('codex'),
    args: z.array(z.string()).optional(),
    assistantMessageId: z.string().min(1),
    cwd: z.string().optional(),
    imageList: z.array(z.object({ id: z.string().optional(), url: z.string() })).optional(),
    jwt: z.string().min(1),
    operationId: z.string().min(1),
    prompt: z.string(),
    providerBinding: z.object({
      kind: z.literal('provider'),
      apiConfig: z.object({ model: z.string().min(1), providerId: z.string().min(1) }),
      resumeBindingKey: z.string().optional(),
    }),
    resumeFallbackSystemContext: z.string().optional(),
    resumeSessionId: z.string().optional(),
    systemContext: z.string().optional(),
    topicId: z.string().min(1),
  })
  .strict();

/** Validated provider-bound dispatch, containing no reusable provider credential. */
export type ProviderBoundAgentRun = z.infer<typeof ProviderBoundAgentRunSchema>;

/** Child-only binding identity attached to native session callbacks. */
export const HETERO_SESSION_BINDING_KEY_ENV = 'LOBEHUB_HETERO_SESSION_BINDING_KEY';
