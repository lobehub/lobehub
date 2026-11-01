import {
  DEFAULT_HETERO_COMMAND,
  detectHeterogeneousCliCommand,
  type HeterogeneousCliAgentType,
} from '@lobechat/heterogeneous-agents/resolveCliCommand';

import { CLI_PRIMARY_BIN } from '../../constants/identity';
import { probeClient, probeGlobalConfig, probeProviders } from '../probes';
import type { CheckOutcome, DoctorCheck } from '../types';
import { enabledProviders } from './server';

/** External CLI agents worth probing unless the caller names others. */
const DEFAULT_HETERO_TYPES: HeterogeneousCliAgentType[] = ['claude-code', 'codex'];

/**
 * Everything `lh agent run` needs, checked in the order it would fail:
 * the agent exists, its model has a provider, that provider has a key.
 *
 * Without this, a missing key surfaces as `InvalidProviderAPIKey` from inside
 * the run — after the run has already been created, and with no indication
 * whether the key is missing on the account or on the server.
 */
const agentReadiness: DoctorCheck = {
  dependsOn: ['server.identity'],
  group: 'execution',
  id: 'execution.agent',
  network: true,
  profiles: ['agent'],
  run: async (ctx): Promise<CheckOutcome> => {
    const requested = ctx.options.agent;
    if (!requested)
      return {
        detail: 'No agent given; pass --agent <id|slug> to check one.',
        skippedBecause: '--agent',
        status: 'skip',
      };

    const client = await probeClient(ctx);
    const resolved = await resolveAgent(client, requested);
    if (!resolved)
      return {
        detail: `No agent matches "${requested}" in the current scope.`,
        evidence: { requested },
        fix: `List them with '${CLI_PRIMARY_BIN} agent list'.`,
        status: 'fail',
      };

    const { agentId, config } = resolved;
    const provider = config.provider as string | undefined;
    const model = config.model as string | undefined;
    const evidence = { agentId, model, provider, title: config.title ?? config.meta?.title };

    if (!provider || !model)
      return {
        detail: `Agent ${agentId} has no model pinned (provider=${provider ?? 'unset'}, model=${model ?? 'unset'}).`,
        evidence,
        fix: `Set one with '${CLI_PRIMARY_BIN} agent edit ${agentId} --model <model> --provider <provider>'.`,
        status: 'warn',
      };

    const [userProviders, globalConfig] = await Promise.all([
      probeProviders(ctx),
      probeGlobalConfig(ctx).catch(() => undefined),
    ]);
    const serverProviders = ((globalConfig as any)?.serverConfig?.aiProvider ?? {}) as Record<
      string,
      { enabled?: boolean }
    >;
    const enabled = enabledProviders(userProviders, serverProviders);

    // The env var name is the part people get wrong: the server upper-cases the
    // provider's internal id, not its display name.
    const addKey = `Add a key for "${provider}" on the account, or set ${provider.toUpperCase()}_API_KEY on the server.`;

    if (!enabled.includes(provider))
      return {
        detail: `Agent ${agentId} runs ${model} on "${provider}", which is not enabled anywhere.`,
        evidence: { ...evidence, enabled },
        fix: addKey,
        status: 'fail',
      };

    // Enabled is not the same as callable: a provider can be toggled on with an
    // empty key vault, and the run then dies with InvalidProviderAPIKey — the
    // exact failure this check exists to pre-empt. So read the key vault of
    // this one provider rather than trusting the toggle.
    const credential = await readProviderCredential(
      client,
      provider,
      Boolean(serverProviders[provider]?.enabled),
    );
    const withCredential = { ...evidence, credentialSource: credential.source };

    if (credential.source === 'none')
      return {
        detail: `Agent ${agentId} runs ${model} on "${provider}", which is enabled but has no key stored.`,
        evidence: withCredential,
        fix: addKey,
        status: 'fail',
      };

    if (credential.source === 'endpoint-only')
      return {
        detail: `Agent ${agentId} runs ${model} on ${provider}, configured with an endpoint and no key — normal for a local runtime, unverifiable from here.`,
        evidence: withCredential,
        fix: `If "${provider}" does need a key, add one; otherwise check the endpoint is reachable from the server.`,
        status: 'warn',
      };

    if (credential.source === 'unknown')
      return {
        detail: `Agent ${agentId} runs ${model} on ${provider}, which is enabled — but this credential cannot read key vaults, so the key itself was not verified.`,
        evidence: withCredential,
        fix: 'Re-run with a full-access login to confirm the provider key.',
        status: 'warn',
      };

    if (credential.source === 'server-enabled')
      return {
        // Deliberately not a claim that a key exists: server-side keys are
        // invisible here, and some providers are enabled regardless of one.
        detail: `Agent ${agentId} runs ${model} on ${provider}, which the server reports as enabled (server-side keys are not visible to the CLI).`,
        evidence: withCredential,
        status: 'ok',
      };

    return {
      detail: `Agent ${agentId} runs ${model} on ${provider}, with a key stored on the account.`,
      evidence: withCredential,
      status: 'ok',
    };
  },
  title: 'agent readiness',
};

interface ResolvedAgent {
  agentId: string;
  config: Record<string, any>;
}

/**
 * Accept whatever the user typed: agent ids carry more than one prefix in the
 * wild (`agt_…` from the id generator, `agent_…` for system agents), so the id
 * lookup is attempted first and a miss falls back to a slug.
 */
async function resolveAgent(client: any, requested: string): Promise<ResolvedAgent | undefined> {
  const direct = await readAgentConfig(client, requested);
  if (direct) return { agentId: requested, config: direct };

  const bySlug = await client.agent.getBuiltinAgent
    .query({ slug: requested })
    .catch(() => undefined);
  const agentId: string | undefined = bySlug?.id || bySlug?.agentId;
  if (!agentId) return undefined;

  const config = await readAgentConfig(client, agentId);
  return config ? { agentId, config } : undefined;
}

/** Key-vault fields that are an address rather than a credential. */
const NON_SECRET_VAULT_FIELDS = new Set(['baseURL', 'endpoint', 'apiVersion']);

export type CredentialSource = 'account' | 'endpoint-only' | 'server-enabled' | 'none' | 'unknown';

/**
 * Where a provider's credential comes from — without ever reading its value.
 *
 * Four answers, because the CLI genuinely cannot reach the same certainty in
 * every case:
 *  - `account`: a secret is stored in this account's key vault.
 *  - `endpoint-only`: a base URL and nothing else, which is the normal shape
 *    for a local runtime (Ollama, LM Studio) that needs no key at all.
 *  - `server-enabled`: the server reports the provider enabled. That is NOT
 *    proof of a key — `deepseek` is enabled unconditionally in the server's
 *    own config, and `ENABLED_OPENAI` / `ENABLED_OLLAMA` default to true — and
 *    server-side keys are invisible to the CLI either way.
 *  - `unknown`: a restricted API key gets the provider back with no key vault
 *    at all, so nothing can be concluded.
 */
async function readProviderCredential(
  client: any,
  provider: string,
  enabledOnServer: boolean,
): Promise<{ source: CredentialSource }> {
  let detail: Record<string, any> | undefined;
  try {
    detail = (await client.aiProvider.getAiProviderById.query({ id: provider })) ?? undefined;
  } catch {
    return { source: enabledOnServer ? 'server-enabled' : 'unknown' };
  }

  const vault = (detail?.keyVaults ?? undefined) as Record<string, unknown> | undefined;
  if (vault) {
    const entries = Object.entries(vault).filter(
      ([, value]) => typeof value === 'string' && value.length > 0,
    );
    if (entries.some(([key]) => !NON_SECRET_VAULT_FIELDS.has(key))) return { source: 'account' };
    if (entries.length > 0) return { source: 'endpoint-only' };
  }

  if (enabledOnServer) return { source: 'server-enabled' };

  // A caller that could read the vault and found it empty knows there is no
  // key; a restricted one cannot tell that apart from not being allowed to look.
  return { source: vault ? 'none' : 'unknown' };
}

async function readAgentConfig(
  client: any,
  agentId: string,
): Promise<Record<string, any> | undefined> {
  try {
    const config = await client.agent.getAgentConfigById.query({ agentId });
    return config ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * External CLI agents (`lh hetero exec`) fail at spawn time with a bare ENOENT
 * when a global install is stale or a broken shim shadows PATH. The resolver
 * used here is the same one the spawn site uses, so a pass means the spawn
 * resolves to the same binary.
 */
const heteroBinaries: DoctorCheck = {
  group: 'execution',
  id: 'execution.hetero',
  profiles: ['hetero'],
  run: async (ctx): Promise<CheckOutcome> => {
    const requested = (
      ctx.options.hetero?.length ? ctx.options.hetero : DEFAULT_HETERO_TYPES
    ) as HeterogeneousCliAgentType[];
    const explicit = Boolean(ctx.options.hetero?.length);

    const statuses = await mapLimit(requested, 4, async (type) => {
      const command = DEFAULT_HETERO_COMMAND[type];
      if (!command) return { available: false, error: 'unknown agent type', type };
      const status = await detectHeterogeneousCliCommand(type, command);
      return {
        available: status.available,
        error: status.error,
        path: status.path,
        type,
        version: status.version,
      };
    });

    const available = statuses.filter((status) => status.available);
    const missing = statuses.filter((status) => !status.available);
    const evidence = Object.fromEntries(
      statuses.map((status) => [
        status.type,
        status.available
          ? `${status.version ?? 'installed'} at ${status.path}`
          : (status.error ?? 'not found'),
      ]),
    );

    if (available.length === 0)
      return {
        detail: `None of ${requested.join(', ')} resolve to a runnable binary.`,
        evidence,
        fix: 'Install at least one external agent CLI, or pass --command to point at yours.',
        status: explicit ? 'fail' : 'warn',
      };

    if (missing.length > 0)
      return {
        detail: `${available.map((status) => `${status.type} ${status.version ?? ''}`.trim()).join(', ')} available; ${missing.map((status) => status.type).join(', ')} missing.`,
        evidence,
        fix: explicit ? 'Install the missing ones, or drop them from --hetero.' : undefined,
        status: explicit ? 'fail' : 'ok',
      };

    return {
      detail: `${available.map((status) => `${status.type} ${status.version ?? ''}`.trim()).join(', ')} available.`,
      evidence,
      status: 'ok',
    };
  },
  title: 'external agent CLIs',
};

/**
 * The only check that proves the chain rather than inspecting it: start a real
 * run and wait for the server to finish it.
 *
 * Gated behind `--deep` and an explicit `--agent` because it costs tokens and
 * leaves a topic behind — a diagnostic must not spend money by default.
 */
/** A model needs minutes, not the ten seconds a health probe gets. */
const roundTripBudget = (options: { timeoutMs: number }): number =>
  Math.max(options.timeoutMs, 300_000);

const roundTrip: DoctorCheck = {
  budgetMs: roundTripBudget,
  deep: true,
  dependsOn: ['execution.agent'],
  group: 'execution',
  id: 'execution.round-trip',
  network: true,
  profiles: ['agent'],
  run: async (ctx): Promise<CheckOutcome> => {
    const requested = ctx.options.agent;
    if (!requested)
      return {
        detail: 'No agent given; pass --agent <id|slug>.',
        skippedBecause: '--agent',
        status: 'skip',
      };

    const client = await probeClient(ctx);
    const resolved = await resolveAgent(client, requested);
    if (!resolved) return { detail: `No agent matches "${requested}".`, status: 'fail' };
    const { agentId } = resolved;

    const startedAt = Date.now();
    const started = (await client.aiAgent.execAgent.mutate({
      agentId,
      prompt: 'Reply with exactly: DOCTOR_OK',
      trigger: 'cli',
      userInterventionConfig: { approvalMode: 'headless' },
    } as any)) as Record<string, any>;

    if (!started?.success || !started.operationId)
      return {
        detail: `The server refused to start a run: ${started?.error ?? started?.message ?? 'unknown error'}.`,
        evidence: { agentId },
        fix: 'This is the same call `lh agent run` makes; the error above is the server’s own.',
        status: 'fail',
      };

    const operationId = started.operationId as string;
    // Leave the runner's own timeout a margin, so a slow run is reported by
    // this check (with the operation id to chase) instead of as a bare timeout.
    const deadline = Date.now() + roundTripBudget(ctx.options) - 5000;

    // Poll immediately, then every couple of seconds: a fast model can be done
    // before the first interval would have elapsed.
    let waitMs = 0;
    // "No longer tracked" only means finished if we saw it running first. On
    // the very first poll it means nothing was observed at all, and calling
    // that a pass would make this check unable to fail.
    let observedRunning = false;
    while (Date.now() < deadline) {
      if (waitMs) await delay(waitMs);
      waitMs = 2000;
      const state = (await client.aiAgent.getOperationStatus.query({
        operationId,
      } as any)) as Record<string, any> | null;
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      const evidence = {
        agentId,
        cost: state?.stats?.totalCost,
        elapsedMs: Date.now() - startedAt,
        operationId,
        steps: state?.stats?.totalSteps,
        tokens: state?.currentState?.usage?.llm?.tokens?.total,
        topicId: started.topicId,
      };

      if (!state) {
        // Null is not a completion signal: the server also answers null when
        // the run's state or metadata is gone (an expired key, a lost Redis
        // entry). Only `isCompleted` proves the round trip; a disappearance is
        // reported as inconclusive either way.
        return {
          detail: observedRunning
            ? `Run ${operationId} stopped being tracked after ${elapsedSeconds}s without reporting completion.`
            : `The server returned no state for run ${operationId}, so nothing was observed to run.`,
          evidence,
          fix: `Check it directly with '${CLI_PRIMARY_BIN} agent status ${operationId}'.`,
          status: 'warn',
        };
      }

      observedRunning = true;

      if (state.hasError)
        return {
          detail: `The run failed after ${elapsedSeconds}s: ${describeRunError(state)}.`,
          evidence,
          fix: `Inspect it with '${CLI_PRIMARY_BIN} trace op inspect ${operationId}'.`,
          status: 'fail',
        };

      if (state.needsHumanInput)
        return {
          detail: `The run is waiting for human input after ${elapsedSeconds}s, despite headless mode.`,
          evidence,
          fix: `Answer it in the app, or inspect it with '${CLI_PRIMARY_BIN} agent status ${operationId}'.`,
          status: 'warn',
        };

      if (state.isCompleted)
        return {
          detail: `Round trip completed in ${elapsedSeconds}s — ${evidence.tokens ?? 0} tokens, $${(evidence.cost ?? 0).toFixed(4)} (operation ${operationId}).`,
          evidence,
          status: 'ok',
        };
    }

    return {
      detail: `The run did not finish within the budget (operation ${operationId}).`,
      evidence: { agentId, operationId },
      fix: `It may still be running — check '${CLI_PRIMARY_BIN} agent status ${operationId}'. Raise --timeout for a slower model.`,
      status: 'warn',
    };
  },
  title: 'agent round trip',
};

function describeRunError(state: Record<string, any>): string {
  const event = (state.recentEvents as { data?: any; type?: string }[] | undefined)?.findLast(
    (candidate) => candidate?.type === 'error',
  );
  return (
    event?.data?.errorType ||
    event?.data?.error ||
    event?.data?.message ||
    state.currentState?.error ||
    'no error detail reported'
  );
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Bounded fan-out: probing every known agent type at once spawns a process storm. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await run(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

export const executionChecks: readonly DoctorCheck[] = [agentReadiness, heteroBinaries, roundTrip];
