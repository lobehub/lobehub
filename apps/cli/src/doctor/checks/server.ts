import { OFFICIAL_AGENT_GATEWAY_URL } from '../../constants/urls';
import { resolveAgentGatewayUrl } from '../../settings';
import { probeClient, probeGlobalConfig, probeProviders } from '../probes';
import { maskEmail } from '../redact';
import type { CheckOutcome, DoctorCheck } from '../types';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Does the server accept this credential, and as whom. */
const identity: DoctorCheck = {
  dependsOn: ['credentials.validity'],
  group: 'server',
  id: 'server.identity',
  network: true,
  profiles: ['core'],
  run: async (ctx): Promise<CheckOutcome> => {
    const client = await probeClient(ctx);

    try {
      const state = (await client.user.getUserState.query()) as Record<string, any>;
      const evidence = {
        email: maskEmail(state.email),
        plan: state.subscriptionPlan,
        userId: state.userId,
        username: state.username,
      };

      return {
        detail: `Authenticated as ${state.username || maskEmail(state.email) || state.userId}${state.subscriptionPlan ? ` (${state.subscriptionPlan})` : ''}.`,
        evidence,
        status: 'ok',
      };
    } catch (error) {
      const message = errorMessage(error);
      const rejected = /UNAUTHORIZED|FORBIDDEN|401|403/i.test(message);

      return {
        detail: rejected
          ? `The server rejected this credential: ${message}.`
          : `The identity call failed: ${message}.`,
        evidence: { error: message },
        fix: rejected
          ? 'Log in again, or check that the credential belongs to this server.'
          : 'The credential looks fine — suspect the server or the network path.',
        status: 'fail',
      };
    }
  },
  title: 'server identity',
};

/**
 * Self-hosting reads as "the CLI is broken" whenever a capability the command
 * needs was never switched on server-side. Gateway mode, the agent gateway URL
 * and server-side file storage are the three that produce the most confusing
 * downstream errors.
 */
const capabilities: DoctorCheck = {
  dependsOn: ['server.identity'],
  group: 'server',
  id: 'server.capabilities',
  network: true,
  profiles: ['agent', 'selfhost'],
  run: async (ctx): Promise<CheckOutcome> => {
    const config = (await probeGlobalConfig(ctx)) as Record<string, any>;
    const serverConfig = (config?.serverConfig ?? {}) as Record<string, any>;
    const cliAgentGateway = resolveAgentGatewayUrl();
    const evidence = {
      cliAgentGatewayUrl: cliAgentGateway,
      enableGatewayMode: serverConfig.enableGatewayMode,
      enableUploadFileToServer: serverConfig.enableUploadFileToServer,
      serverAgentGatewayUrl: serverConfig.agentGatewayUrl,
    };

    const problems: string[] = [];
    const fixes: string[] = [];
    // A capability that is merely off degrades one feature; streaming from
    // someone else's agent gateway means every run silently goes nowhere.
    let status: CheckOutcome['status'] = 'warn';

    if (serverConfig.enableGatewayMode === false) {
      problems.push('gateway mode is off, so the server will not run agents on your behalf');
      fixes.push('set AGENT_RUNTIME_MODE / the gateway env on the server');
    }

    if (
      serverConfig.agentGatewayUrl &&
      cliAgentGateway &&
      serverConfig.agentGatewayUrl.replace(/\/$/, '') !== cliAgentGateway.replace(/\/$/, '')
    ) {
      problems.push(
        `the server advertises agent gateway ${serverConfig.agentGatewayUrl} but this CLI streams from ${cliAgentGateway}`,
      );
      fixes.push(`export AGENT_GATEWAY_URL=${serverConfig.agentGatewayUrl}`);
      if (cliAgentGateway === OFFICIAL_AGENT_GATEWAY_URL) status = 'fail';
    }

    if (serverConfig.enableUploadFileToServer === false) {
      problems.push('server-side file storage is off, so uploads and evidence capture will fail');
      fixes.push('configure S3_* on the server');
    }

    if (problems.length > 0)
      return { detail: `${problems.join('; ')}.`, evidence, fix: fixes.join('; '), status };

    return {
      detail: `Gateway mode ${serverConfig.enableGatewayMode ? 'on' : 'unset'}, server-side file storage ${serverConfig.enableUploadFileToServer ? 'on' : 'unset'}.`,
      evidence,
      status: 'ok',
    };
  },
  title: 'server capabilities',
};

/**
 * Whether any model can actually be called.
 *
 * This is the check that turns `InvalidProviderAPIKey` — raised deep inside a
 * run, after minutes of setup — into a one-line answer before the run starts.
 */
const providers: DoctorCheck = {
  dependsOn: ['server.identity'],
  group: 'server',
  id: 'server.providers',
  network: true,
  profiles: ['agent', 'selfhost'],
  run: async (ctx): Promise<CheckOutcome> => {
    const [userProviders, config] = await Promise.all([
      probeProviders(ctx),
      probeGlobalConfig(ctx).catch(() => undefined),
    ]);

    const serverProviders = ((config as any)?.serverConfig?.aiProvider ?? {}) as Record<
      string,
      { enabled?: boolean }
    >;
    const enabled = enabledProviders(userProviders, serverProviders);
    const evidence = {
      enabled,
      fromServerEnv: Object.entries(serverProviders)
        .filter(([, value]) => value?.enabled)
        .map(([id]) => id),
    };

    if (enabled.length === 0)
      return {
        detail: 'No provider is enabled, on the account or on the server.',
        evidence,
        fix: "Add a key with 'lh provider' in the app, or set <PROVIDER>_API_KEY on the server.",
        status: 'fail',
      };

    // Enablement is not the same as having a key — a provider can be toggled on
    // with an empty key vault. Whether a specific one can actually be called is
    // answered per agent by `execution.agent`.
    return {
      detail: `${enabled.length} enabled provider(s): ${enabled.slice(0, 6).join(', ')}${enabled.length > 6 ? '…' : ''}.`,
      evidence,
      status: 'ok',
    };
  },
  title: 'model providers',
};

/**
 * Providers enabled on the account, plus those the server enables from its env.
 *
 * Enabled is all this can honestly claim: `getAiProviderList` reports the
 * toggle, and a provider can be switched on with no key stored at all.
 */
export function enabledProviders(
  userProviders: any[],
  serverProviders: Record<string, { enabled?: boolean }>,
): string[] {
  const enabled = new Set<string>();

  for (const provider of userProviders)
    if (provider?.enabled && provider.id) enabled.add(String(provider.id));
  for (const [id, value] of Object.entries(serverProviders)) if (value?.enabled) enabled.add(id);

  return [...enabled].sort();
}

export const serverChecks: readonly DoctorCheck[] = [identity, capabilities, providers];
