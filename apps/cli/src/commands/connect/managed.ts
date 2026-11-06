import type { resolveToken } from '../../auth/resolveToken';
import {
  MANAGED_DEVICE_SECRET_ENV,
  type ManagedDeviceConfig,
  type ManagedDeviceToken,
  type ManagedTokenFatalError,
  ManagedTokenSession,
  readManagedDeviceConfig,
  readManagedTokenPrincipal,
} from '../../device/managed';

interface ManagedFlagOptions {
  daemon?: boolean;
  deviceId?: string;
  gateway?: string;
  public?: boolean;
  token?: string;
  workspace?: string;
}

/**
 * Flags that pick an identity, credential or gateway, which the environment
 * owns in managed mode, plus `--daemon`: the platform supervises the agent in
 * the foreground and restarts it when it exits.
 */
export function getManagedFlagConflicts(options: ManagedFlagOptions): string[] {
  return [
    options.token && '--token',
    options.gateway && '--gateway',
    options.deviceId && '--device-id',
    options.workspace && '--workspace',
    options.public && '--public',
    options.daemon && '--daemon',
  ].filter((flag): flag is string => !!flag);
}

interface ManagedDeviceEvents {
  onFatal: (err: ManagedTokenFatalError) => void;
  onToken: (token: ManagedDeviceToken) => void;
}

export interface ManagedDeviceStart {
  auth: Awaited<ReturnType<typeof resolveToken>>;
  config: ManagedDeviceConfig;
  /** Assigned once the gateway client exists. */
  events: ManagedDeviceEvents;
  principal: ReturnType<typeof readManagedTokenPrincipal>;
  session: ManagedTokenSession;
}

/**
 * Read the managed device environment and get the first gateway token. Exits
 * with status 1 when the environment is incomplete or the server gives a final
 * answer (401 bad secret, 404 no managed devices); keeps retrying 5xx and
 * network failures.
 */
export async function startManagedDevice(logger: {
  debug: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}): Promise<ManagedDeviceStart> {
  const read = readManagedDeviceConfig();
  if (!read.ok) {
    logger.error(read.message);
    process.exit(1);
    throw new Error('process.exit');
  }
  const { config } = read;
  // Keep the secret out of the environment that tool calls and agent runs
  // inherit. Processes of the same user can still read the environment this
  // process started with.
  delete process.env[MANAGED_DEVICE_SECRET_ENV];

  const events: ManagedDeviceEvents = {
    onFatal: () => {},
    onToken: () => {},
  };
  const session = new ManagedTokenSession({
    config,
    logger: {
      debug: logger.debug,
      warn: logger.info,
    },
    onFatal: (err) => events.onFatal(err),
    onToken: (token) => events.onToken(token),
  });

  try {
    const token = await session.start();
    const principal = readManagedTokenPrincipal(token.token);
    return {
      auth: {
        serverUrl: config.serverUrl,
        token: token.token,
        tokenType: 'jwt',
        userId: principal.userId ?? principal.workspaceId,
      },
      config,
      events,
      principal,
      session,
    };
  } catch (err) {
    session.stop();
    logger.error((err as Error).message);
    process.exit(1);
    throw new Error('process.exit', { cause: err });
  }
}
