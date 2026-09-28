import { GatewayClient } from '@lobechat/device-gateway-client';

import { CLI_PRIMARY_BIN } from '../../constants/identity';
import { getRunningDaemonPid, readStatus, removePid, removeStatus } from '../../daemon/manager';
import { readConnectServiceStatus } from '../../service/connect';
import { resolveLocalDeviceId } from '../../utils/device';
import { probeCredential, probeDevices } from '../probes';
import { redactUrlCredentials, redactUrlsInMessage } from '../redact';
import type { CheckOutcome, DoctorCheck } from '../types';
import { resolveEndpoints } from './endpoints';

/**
 * Is there a `lh connect` daemon on this machine, and is the state it left
 * behind still true?
 */
const daemon: DoctorCheck = {
  group: 'device',
  id: 'device.daemon',
  profiles: ['connect'],
  repair: (_ctx, result) => {
    // Only the leftover-files case is repairable. A daemon that is merely
    // reconnecting is still a live process: deleting its pid file would orphan
    // it where `connect stop` can never find it, and the next `connect` would
    // start a second one alongside it.
    if (result.evidence?.repairable !== 'stale-files')
      throw new Error('the daemon process is still running, so its pid file is not stale');

    removePid();
    removeStatus();
    return 'removed the stale daemon pid/status files';
  },
  run: (): CheckOutcome => {
    // Also self-heals: a pid file whose process is gone (or was recycled by the
    // OS) is deleted as a side effect of asking.
    const pid = getRunningDaemonPid();
    const status = readStatus();
    const service = readServiceStatus();
    const evidence = {
      connectionStatus: status?.connectionStatus,
      deviceId: status?.deviceId,
      gatewayUrl: status?.gatewayUrl,
      pid,
      service,
    };

    if (!pid) {
      if (status)
        return {
          detail: 'A daemon status file is left over, but no daemon is running.',
          evidence: { ...evidence, repairable: 'stale-files' },
          fix: `Run '${CLI_PRIMARY_BIN} connect --daemon', or re-run with --fix to clear the leftovers.`,
          status: 'warn',
        };

      return {
        detail: 'No connect daemon on this machine.',
        evidence,
        fix: `Run '${CLI_PRIMARY_BIN} connect --daemon' if this machine should be reachable as a device.`,
        status: 'warn',
      };
    }

    // A live process is not a connection: success needs the daemon's own report.
    if (!status?.connectionStatus)
      return {
        detail: `Daemon ${pid} is running but has not reported a connection state.`,
        evidence,
        fix: `Check the daemon log: ${CLI_PRIMARY_BIN} connect logs`,
        status: 'warn',
      };

    if (status.connectionStatus !== 'connected')
      return {
        detail: `Daemon ${pid} is running but its last known state is "${status.connectionStatus}".`,
        evidence,
        fix: `Check the daemon log: ${CLI_PRIMARY_BIN} connect logs`,
        status: 'warn',
      };

    return {
      detail: `Daemon ${pid} connected as device ${status.deviceId ?? 'unknown'}.`,
      evidence,
      status: 'ok',
    };
  },
  title: 'connect daemon',
};

function readServiceStatus(): unknown {
  try {
    return readConnectServiceStatus();
  } catch {
    // Not installed, or not a systemd platform — neither is a finding.
    return undefined;
  }
}

/**
 * Can this machine authenticate to the device gateway at all — separating
 * "wrong URL", "rejected token" and "nothing answers", which all present as a
 * bare DEVICE_OFFLINE to whoever called the tool.
 */
const gatewayHandshake: DoctorCheck = {
  dependsOn: ['credentials.validity', 'endpoints.resolution'],
  group: 'device',
  id: 'device.gateway',
  network: true,
  profiles: ['connect'],
  run: async (ctx): Promise<CheckOutcome> => {
    const credential = await probeCredential(ctx);
    if (!credential.token || !credential.userId)
      return {
        detail: 'No usable credential to authenticate the gateway with.',
        fix: `Run '${CLI_PRIMARY_BIN} login'.`,
        status: 'fail',
      };

    const { gatewayUrl } = resolveEndpoints();
    // The URL is used verbatim to connect and redacted everywhere it is shown.
    const shownUrl = redactUrlCredentials(gatewayUrl);
    const evidence = { gatewayUrl: shownUrl, tokenType: credential.tokenType };

    const outcome = await new Promise<CheckOutcome>((resolve) => {
      const client = new GatewayClient({
        autoReconnect: false,
        gatewayUrl,
        serverUrl: credential.serverUrl,
        // A probe connection proves reachability and exits; it must never
        // advertise itself as able to serve tunnels.
        tunnel: false,
        token: credential.token!,
        tokenType: credential.tokenType,
        userId: credential.userId!,
      });

      const settle = (result: CheckOutcome) => {
        clearTimeout(timer);
        client.disconnect();
        resolve(result);
      };

      const timer = setTimeout(
        () =>
          settle({
            detail: `${shownUrl} did not complete a handshake within ${ctx.options.timeoutMs}ms.`,
            evidence,
            fix: 'Check egress to the gateway host (WebSocket upgrades are what proxies drop first).',
            status: 'fail',
          }),
        ctx.options.timeoutMs,
      );

      // An EventEmitter throws on an unhandled `error`, and a socket failure
      // (DNS, refused, TLS) arrives there — not through `connect()`'s promise.
      // Without this listener a network problem crashes the whole report.
      client.on('error', (error: Error) =>
        settle({
          detail: `Could not reach ${shownUrl}: ${redactUrlsInMessage(error.message)}.`,
          evidence,
          fix: 'Check the gateway URL and this machine’s egress.',
          status: 'fail',
        }),
      );
      client.on('connected', () =>
        settle({ detail: `Authenticated to ${shownUrl}.`, evidence, status: 'ok' }),
      );
      client.on('auth_failed', (reason: string) =>
        settle({
          detail: `${shownUrl} rejected the credential: ${reason}.`,
          evidence,
          fix: 'The gateway and the server must trust the same issuer — check the gateway URL matches this server.',
          status: 'fail',
        }),
      );
      client.on('auth_expired', () =>
        settle({
          detail: `${shownUrl} reports the credential expired.`,
          evidence,
          fix: `Run '${CLI_PRIMARY_BIN} login' again.`,
          status: 'fail',
        }),
      );
      client.on('disconnected', () =>
        settle({
          detail: `${shownUrl} closed the connection before it was established.`,
          evidence,
          fix: 'Usually a gateway URL that belongs to a different deployment than the server.',
          status: 'fail',
        }),
      );

      void client.connect().catch((error: unknown) =>
        settle({
          detail: `Could not reach ${shownUrl}: ${redactUrlsInMessage(error instanceof Error ? error.message : String(error))}.`,
          evidence,
          fix: 'Check the gateway URL and this machine’s egress.',
          status: 'fail',
        }),
      );
    });

    return outcome;
  },
  title: 'gateway handshake',
};

/** Whether the server agrees this machine is an online device right now. */
const registration: DoctorCheck = {
  dependsOn: ['server.identity'],
  group: 'device',
  id: 'device.registration',
  network: true,
  profiles: ['connect'],
  run: async (ctx): Promise<CheckOutcome> => {
    const devices = await probeDevices(ctx);
    const localDeviceId = resolveLocalDeviceId();
    const online = devices.filter((device) => device?.online);
    const evidence = {
      localDeviceId,
      online: online.map((device) => device.deviceId),
      total: devices.length,
    };

    if (!localDeviceId)
      return {
        detail: `${online.length} device(s) online for this account, but this machine is not one of them.`,
        evidence,
        fix: `Run '${CLI_PRIMARY_BIN} connect' here to make it reachable.`,
        status: online.length > 0 ? 'warn' : 'fail',
      };

    const local = devices.find((device) => device?.deviceId === localDeviceId);
    if (!local)
      return {
        detail: `This machine's device id ${localDeviceId} is not registered on the server.`,
        evidence,
        fix: `Reconnect with '${CLI_PRIMARY_BIN} connect'.`,
        status: 'fail',
      };

    if (!local.online)
      return {
        detail: `Device ${localDeviceId} is registered but offline.`,
        evidence,
        fix: `Reconnect with '${CLI_PRIMARY_BIN} connect'.`,
        status: 'fail',
      };

    return {
      detail: `Device ${localDeviceId} is online (${online.length} online in total).`,
      evidence,
      status: 'ok',
    };
  },
  title: 'device registration',
};

export const deviceChecks: readonly DoctorCheck[] = [daemon, gatewayHandshake, registration];
