import type { LobeChatDatabase } from '@lobechat/database';
import { getCodexAppServerUnsupportedArgs } from '@lobechat/heterogeneous-agents/codexAppServerParams';
import type { DeviceClient, LobeAgentAgencyConfig } from '@lobechat/types';
import debug from 'debug';

import { UserModel } from '@/database/models/user';

const log = debug('lobe-server:ai-agent-service');

/** Device capability advertised by a CLI that can run `lh hetero exec --codex-app-server`. */
export const CODEX_APP_SERVER_RUNTIME = 'codex-app-server-v1';

/**
 * Clients in the order the device gateway routes an agent run among one device's
 * connections: `lh connect` ranks ahead of the Desktop app.
 */
const AGENT_RUN_CLIENT_ORDER: readonly DeviceClient[][] = [['cli'], ['desktop']];

/** A system-info read of one client's connection; a failure keeps the gateway's reason. */
export type AgentRunSystemInfoRead =
  | { ok: true; systemInfo: { supportedAgentRuntimes?: readonly string[] } }
  | { ok: false; reason: string };

export interface AgentRunRuntimeProbe {
  /** The client whose connection answered; pin the native dispatch to it. */
  clientKinds?: DeviceClient[];
  runtimes?: readonly string[];
}

/**
 * Reads native runtimes from the connection an agent run will actually reach.
 *
 * Use when:
 * - Deciding whether a device run may carry native wrapper flags.
 * Expects:
 * - `read` restricts the system-info request to the given clients.
 * Returns:
 * - The runtimes of the first client in agent-run routing order that is connected,
 *   with that client so the dispatch can be pinned to the same connection; no
 *   runtimes when that client did not answer.
 *
 * Call stack:
 *
 * dispatchHeteroAgent
 *   -> {@link probeAgentRunRuntimes}
 *     -> deviceGateway.readDeviceSystemInfo
 */
export const probeAgentRunRuntimes = async (
  read: (clientKinds: DeviceClient[]) => Promise<AgentRunSystemInfoRead>,
): Promise<AgentRunRuntimeProbe> => {
  for (const clientKinds of AGENT_RUN_CLIENT_ORDER) {
    const result = await read(clientKinds);
    if (result.ok) return { clientKinds, runtimes: result.systemInfo.supportedAgentRuntimes };
    // Only "no connection of this client" moves on; an unanswered read is not a capability.
    if (result.reason !== 'NO_CAPABLE_CONNECTION') return {};
  }
  return {};
};

/** How a connected device runs one Codex turn. */
export type CodexDeviceRuntime =
  /** Keep the existing `codex exec` path and its transcript recovery. */
  | { kind: 'exec' }
  /** The turn must not run; the caller settles it as a dispatch error. */
  | { kind: 'error'; message: string }
  | {
      /** Extra `lh hetero exec` wrapper flags. */
      args: string[];
      kind: 'native';
    };

export interface ResolveCodexDeviceRuntimeParams {
  /** Raw Codex provider arguments forwarded to the agent; native mode must honor all of them. */
  agentArgs?: readonly string[];
  /** `api` auth uses the hosted provider binding, which has no native app-server session. */
  authMode?: string;
  heteroType: string;
  /** Reads the user's Labs `enableCodexAppServer` preference. */
  isAppServerLabEnabled: () => Promise<boolean>;
  /** Reads the live connection's advertised runtimes, never merged DB metadata. */
  querySupportedRuntimes: () => Promise<readonly string[] | undefined>;
  /** Whether this turn resumes a saved native session. */
  resume?: boolean;
}

/**
 * Chooses between `codex exec` and the native app-server runtime for a device run.
 *
 * Use when:
 * - Dispatching a Codex turn to a connected device.
 * Expects:
 * - The live connection reports `codex-app-server-v1` only after a native handshake.
 * Returns:
 * - `exec` for every run unless the user enabled the Labs app-server runtime, the
 *   device supports it, and app-server can honor every provider argument; native runs
 *   keep transcript recovery.
 *
 * Call stack:
 *
 * dispatchHeteroAgent
 *   -> {@link resolveCodexDeviceRuntime}
 */
export const resolveCodexDeviceRuntime = async (
  params: ResolveCodexDeviceRuntimeParams,
): Promise<CodexDeviceRuntime> => {
  if (params.heteroType !== 'codex') return { kind: 'exec' };
  const nativeAuth = params.authMode !== 'api';

  // Codex topics keep `codex exec` by default. The app-server runtime is opt-in through
  // the same Labs preference Desktop local runs use; it records native turn IDs.
  if (!nativeAuth || !(await params.isAppServerLabEnabled())) return { kind: 'exec' };
  // `codex exec` accepts options (e.g. `--profile`) the native thread contract cannot
  // represent; the device handle rejects them, so keep those configurations on exec.
  const unsupported = getCodexAppServerUnsupportedArgs([...(params.agentArgs ?? [])], {
    resume: params.resume,
  });
  if (unsupported.length > 0) return { kind: 'exec' };
  const runtimes = await params.querySupportedRuntimes();
  if (!runtimes?.includes(CODEX_APP_SERVER_RUNTIME)) return { kind: 'exec' };
  return { args: ['--codex-app-server'], kind: 'native' };
};

/** A {@link CodexDeviceRuntime} whose native variant names the connection to pin. */
export type CodexDeviceDispatch =
  | Exclude<CodexDeviceRuntime, { kind: 'native' }>
  | (Extract<CodexDeviceRuntime, { kind: 'native' }> & {
      /** The client that advertised the native runtime; the native dispatch is pinned to it. */
      clientKinds?: DeviceClient[];
    });

export interface SelectCodexDeviceDispatchParams {
  db: LobeChatDatabase;
  heterogeneousProvider?: LobeAgentAgencyConfig['heterogeneousProvider'];
  heteroType: string;
  /** Reads system info from the dispatch device, restricted to the given clients. */
  readSystemInfo: (clientKinds: DeviceClient[]) => Promise<AgentRunSystemInfoRead>;
  /** Whether this turn resumes a saved native session. */
  resume: boolean;
  userId: string;
}

/**
 * Chooses how a device dispatch runs Codex and which connection a native run is pinned to.
 *
 * Use when:
 * - `dispatchHeteroAgent` has resolved the device a hetero run is dispatched to.
 * Expects:
 * - `readSystemInfo` reads the live connection of that device, not merged DB metadata.
 * Returns:
 * - The {@link resolveCodexDeviceRuntime} result, with the probed client on `native`;
 *   a thrown failure becomes `error` so the caller settles the turn as a dispatch error.
 *
 * Call stack:
 *
 * dispatchHeteroAgent
 *   -> {@link selectCodexDeviceDispatch}
 *     -> {@link resolveCodexDeviceRuntime}
 *       -> {@link probeAgentRunRuntimes}
 */
export const selectCodexDeviceDispatch = async (
  params: SelectCodexDeviceDispatchParams,
): Promise<CodexDeviceDispatch> => {
  const { heterogeneousProvider, heteroType } = params;
  let clientKinds: DeviceClient[] | undefined;
  let runtime: CodexDeviceRuntime;
  try {
    runtime = await resolveCodexDeviceRuntime({
      agentArgs:
        heterogeneousProvider?.type === heteroType ? heterogeneousProvider.args : undefined,
      authMode: heterogeneousProvider?.authMode,
      heteroType,
      isAppServerLabEnabled: async () => {
        try {
          const preference = await new UserModel(params.db, params.userId).getUserPreference();
          return preference?.lab?.enableCodexAppServer === true;
        } catch (err) {
          log('execAgent: failed to read Codex app-server Lab preference: %O', err);
          return false;
        }
      },
      // Query the live connection that receives the run, not merged DB metadata:
      // downgrade/reconnect must revoke it, and another client may differ.
      querySupportedRuntimes: async () => {
        const probe = await probeAgentRunRuntimes(params.readSystemInfo);
        clientKinds = probe.clientKinds;
        return probe.runtimes;
      },
      resume: params.resume,
    });
  } catch (err) {
    runtime = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  if (runtime.kind === 'error') {
    log('execAgent: native Codex dispatch rejected: %s', runtime.message);
  }
  return runtime.kind === 'native' ? { ...runtime, clientKinds } : runtime;
};
