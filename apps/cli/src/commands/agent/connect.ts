/**
 * `lh agent connect [types...]` — the CLI counterpart of the Web "Connect
 * agent" wizard: scan a connected device for external agent CLIs (Claude Code,
 * Codex, Antigravity, …) and create one agent per pick, bound to that device.
 *
 * The device is this machine by default, in the pool of the current scope: a
 * workspace device inside a workspace, else the personal one. Both the scan
 * (`device.scanAgents`) and the agent config (`buildConnectAgentConfig`) are
 * the ones the wizard uses, so a CLI-created agent matches a wizard-created one.
 */
import type { HeterogeneousAgentScanMap } from '@lobechat/heterogeneous-agents';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type { ConnectableAgentDescriptor } from '@lobechat/heterogeneous-agents/connectAgent';
import {
  buildConnectAgentConfig,
  CONNECTABLE_AGENT_DESCRIPTORS,
  connectedAgentDefaultName,
  getConnectableAgentDescriptor,
} from '@lobechat/heterogeneous-agents/connectAgent';
import type { Command } from 'commander';
import { Option } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { resolveWorkspaceId } from '../../api/workspace';
import { resolveDeviceIdentity, resolveWorkspaceDeviceIdentity } from '../../device/register';
import { loadOrCreateConnectionId } from '../../settings';
import { confirm, outputJson, printTable } from '../../utils/format';
import { log } from '../../utils/logger';
import { resolveAppUrlBuilder } from '../task/url';

const VISIBILITIES = ['private', 'public'] as const;
type Visibility = (typeof VISIBILITIES)[number];

interface ConnectOptions {
  description?: string;
  device?: string;
  json?: string | boolean;
  name?: string;
  visibility?: Visibility;
  yes?: boolean;
}

interface DeviceRow {
  deviceId: string;
  friendlyName?: string | null;
  hostname?: string | null;
  online?: boolean;
  scope?: 'personal' | 'workspace';
}

const fail = (message: string, hint?: string): never => {
  log.error(message);
  if (hint) console.log(pc.dim(hint));
  process.exit(1);
  // `process.exit` is mocked in tests; stop the action there too.
  throw new Error(message);
};

/** Same label as the Web wizard. */
const deviceLabel = (device: DeviceRow) =>
  device.friendlyName || device.hostname || device.deviceId;

const connectHint = (workspaceId?: string) =>
  workspaceId
    ? `Connect this machine to the workspace first: lh connect --workspace ${workspaceId}`
    : 'Connect this machine first: lh connect';

/**
 * The device to bind: `--device`, else this machine's identity in the current
 * scope's pool. Inside a workspace only workspace devices qualify, as in the
 * wizard's picker — a personal device is not reachable by the workspace.
 */
const resolveTargetDevice = async (
  devices: DeviceRow[],
  options: { deviceId?: string; userId?: string; workspaceId?: string },
): Promise<DeviceRow> => {
  const { deviceId, userId, workspaceId } = options;
  const eligible = workspaceId ? devices.filter((d) => d.scope === 'workspace') : devices;

  if (deviceId) {
    const device = eligible.find((d) => d.deviceId === deviceId);
    if (!device) {
      fail(
        workspaceId
          ? `Device ${deviceId} is not a device of workspace ${workspaceId}.`
          : `Device ${deviceId} not found.`,
        'List the devices you can bind with: lh device list',
      );
    }
    return device!;
  }

  const ownId = workspaceId
    ? resolveWorkspaceDeviceIdentity(workspaceId, undefined, loadOrCreateConnectionId()).deviceId
    : resolveDeviceIdentity(userId)?.deviceId;
  const device = ownId ? eligible.find((d) => d.deviceId === ownId) : undefined;
  if (!device) {
    fail(
      workspaceId
        ? `This machine is not connected to workspace ${workspaceId}.`
        : 'This machine is not connected to LobeHub.',
      `${connectHint(workspaceId)}\nOr bind another device with --device <deviceId> (see lh device list).`,
    );
  }
  return device!;
};

/** Resolve the named types before any network call, so a typo fails first. */
const resolveNamedProviders = (types: string[]): ConnectableAgentDescriptor[] =>
  [...new Set(types)].map((type) => {
    const descriptor = getConnectableAgentDescriptor(type);
    if (!descriptor) {
      fail(
        `Unknown agent type: ${type}`,
        `Known types: ${CONNECTABLE_AGENT_DESCRIPTORS.map((d) => d.type).join(', ')}`,
      );
    }
    return descriptor!;
  });

/** The descriptors to connect: the named ones, else everything the scan found. */
const selectAvailable = (
  named: ConnectableAgentDescriptor[],
  agents: HeterogeneousAgentScanMap,
): ConnectableAgentDescriptor[] => {
  if (named.length === 0) {
    return CONNECTABLE_AGENT_DESCRIPTORS.filter((d) => agents[d.type]?.available);
  }

  for (const descriptor of named) {
    const status = agents[descriptor.type];
    if (!status?.available) {
      fail(
        `${descriptor.title} was not found on the device${status?.reason ? `: ${status.reason}` : '.'}`,
        'Install it on that device (or put it on its PATH), then rerun.',
      );
    }
  }
  return named;
};

/**
 * Agent types the caller already has an agent for on the device, so a rerun
 * connects only what is missing. Teammates' agents on a shared workspace device
 * do not count: each member connects their own. Best effort: when the lookup fails the
 * command still connects, it just cannot skip duplicates.
 */
const findConnectedAgents = async (
  client: Awaited<ReturnType<typeof getTrpcClient>>,
  deviceId: string,
  userId: string | undefined,
): Promise<Map<string, string>> => {
  const connected = new Map<string, string>();
  try {
    const { agents } = (await client.device.getDeviceActivity.query({ deviceId })) as {
      agents: Array<{ id: string }>;
    };
    const configs = await Promise.all(
      agents.map((agent) => client.agent.getAgentConfigById.query({ agentId: agent.id })),
    );
    configs.forEach((config: any, index: number) => {
      const type = config?.agencyConfig?.heterogeneousProvider?.type;
      if (!type || connected.has(type) || config.userId !== userId) return;
      connected.set(type, agents[index].id);
    });
  } catch (error) {
    log.warn(
      `Could not list the agents already on this device, so duplicates are not skipped: ${(error as Error).message}`,
    );
  }
  return connected;
};

export function registerAgentConnectCommand(agent: Command) {
  agent
    .command('connect [types...]')
    .description(
      'Scan a connected device for external agent CLIs (Claude Code, Codex, Antigravity, …) and create agents bound to it',
    )
    .option(
      '--device <deviceId>',
      'Bind to this device instead of this machine (see lh device list)',
    )
    .addOption(
      new Option(
        '--visibility <visibility>',
        'Who can see the agents in a workspace: `private` (only you) or `public` (workspace members)',
      )
        .choices(VISIBILITIES)
        .default('private'),
    )
    .option('-n, --name <name>', 'Agent name (only when connecting one agent)')
    .option('-d, --description <desc>', 'Agent description (only when connecting one agent)')
    .option('--yes', 'Skip confirmation prompt')
    .option('--json [fields]', 'Output the created agents as JSON, optionally selecting fields')
    .addHelpText(
      'after',
      `
Examples:
  lh agent connect                       Connect every agent CLI found on this machine
                                         (types already connected to it are skipped)
  lh agent connect antigravity --yes     Connect Antigravity without prompting
  lh agent connect codex --visibility public --device <deviceId>`,
    )
    .action(async (types: string[], options: ConnectOptions) => {
      if ((options.name || options.description) && types.length !== 1) {
        fail('--name and --description need exactly one agent type, e.g. lh agent connect codex');
      }
      const named = resolveNamedProviders(types);

      const client = await getTrpcClient();
      const workspaceId = resolveWorkspaceId();

      const [user, devices] = await Promise.all([
        client.user.getUserState.query() as Promise<any>,
        client.device.listDevices.query() as Promise<DeviceRow[]>,
      ]);

      const device = await resolveTargetDevice(devices, {
        deviceId: options.device,
        userId: user?.userId,
        workspaceId,
      });
      if (!device.online) {
        fail(
          `Device ${deviceLabel(device)} is offline.`,
          options.device ? 'Run lh connect on that device, then rerun.' : connectHint(workspaceId),
        );
      }

      const scan = await client.device.scanAgents.query({ deviceId: device.deviceId });
      if (scan.error) fail(`Could not scan ${deviceLabel(device)}: ${scan.error}`);

      const label = deviceLabel(device);
      const available = selectAvailable(named, scan.agents);
      if (available.length === 0) {
        fail(
          `No external agent CLI found on ${label}.`,
          `Supported: ${CONNECTABLE_AGENT_DESCRIPTORS.map((d) => d.title).join(', ')}`,
        );
      }

      const connected = await findConnectedAgents(client, device.deviceId, user?.userId);
      const skipped = available
        .filter((p) => connected.has(p.type))
        .map((p) => ({ id: connected.get(p.type)!, title: p.title, type: p.type }));
      // `--json` keeps stdout parseable; skipped agents are in its payload instead.
      if (options.json === undefined) {
        for (const s of skipped) {
          log.info(`${s.title} is already connected to ${label} (${s.id}); skipping.`);
        }
      }
      const providers = available.filter((p) => !connected.has(p.type));

      // Visibility only exists inside a workspace; personal agents are the owner's.
      const visibility = workspaceId ? options.visibility : undefined;

      if (providers.length > 0 && !options.yes) {
        const names = providers.map((p) => p.title).join(', ');
        const where = workspaceId ? ` in workspace ${workspaceId} as ${visibility}` : '';
        const confirmed = await confirm(
          `Create ${providers.length} agent(s) bound to ${label}${where}: ${names}?`,
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const buildUrl = await resolveAppUrlBuilder(client);
      const ownerName = user?.fullName || user?.username;
      const created: Array<{
        id: string;
        title: string;
        type: string;
        url: string;
        version?: string;
      }> = [];

      // Sequential: a failure stops before creating the rest; a rerun skips the
      // ones already created, since they are now bound to the device.
      for (const provider of providers) {
        const profile =
          provider.kind === 'platform' && isRemoteHeterogeneousType(provider.type)
            ? await client.device.getAgentProfile
                .query({ deviceId: device.deviceId, platform: provider.type })
                .catch(() => undefined)
            : undefined;
        const config = buildConnectAgentConfig({
          overrides: { description: options.description, name: options.name },
          profile,
          provider,
          target: { deviceId: device.deviceId, kind: 'device' },
        });
        const title =
          config.name ||
          connectedAgentDefaultName({
            ownerName,
            productTitle: config.title,
            visibility,
            workspaceId,
          }) ||
          provider.title;

        try {
          const result = (await client.agent.createAgent.mutate({
            config: { ...config, name: title },
            ...(visibility ? { visibility } : {}),
          } as any)) as { agentId?: string; id?: string };
          const id = (result.agentId || result.id)!;
          created.push({
            id,
            title,
            type: provider.type,
            url: buildUrl(`/agent/${encodeURIComponent(id)}`),
            version: scan.agents[provider.type]?.version,
          });
        } catch (error) {
          if (created.length > 0) {
            log.warn(`Created before the failure: ${created.map((c) => c.id).join(', ')}`);
          }
          fail(`Failed to create the ${provider.title} agent: ${(error as Error).message}`);
        }
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson({ created, deviceId: device.deviceId, skipped }, fields);
        return;
      }

      if (created.length === 0) {
        console.log(`${pc.green('✓')} Everything found on ${pc.bold(label)} is already connected.`);
        return;
      }
      console.log(`${pc.green('✓')} Connected ${created.length} agent(s) on ${pc.bold(label)}:`);
      printTable(
        created.map((c) => [c.title, c.type, c.version ?? '', c.id, c.url]),
        ['NAME', 'TYPE', 'VERSION', 'ID', 'URL'],
      );
      console.log(
        pc.dim(
          'An agent CLI that needs sign-in (e.g. Antigravity, Codex) must be signed in on the device before its first run.',
        ),
      );
    });
}
