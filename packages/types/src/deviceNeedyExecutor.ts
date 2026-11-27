/**
 * A needy executor runner the server attaches to a connected device, so a
 * needy actor elsewhere (e.g. a cloud VM running an agent CLI) can route the
 * commands it starts to this device. The device-control RPCs
 * `attachNeedyExecutor` and `detachNeedyExecutor` carry these shapes.
 *
 * The params are structured on purpose: the device validates them and builds
 * needy's command line itself, so a server or gateway can never make it run a
 * command string of its choosing.
 *
 * Design: https://github.com/needy-dev/needy/pull/137
 */

/** The needy control daemon the runner dials, as host and port only. */
export interface NeedyExecutorAddress {
  /** A DNS name or an IP address; no scheme, path or credentials. */
  host: string;
  port: number;
}

export interface AttachNeedyExecutorParams {
  address: NeedyExecutorAddress;
  /** Caller-chosen id; attaching the same id again with the same params reuses the runner. */
  attachmentId: string;
  /**
   * The runner credential the daemon minted for `runnerName`. Never log, echo
   * or persist it outside the attachment's private directory.
   */
  credential: string;
  /** The needy runner name the credential was minted for (a DNS label). */
  runnerName: string;
  /** The device stops the runner after this long even without a detach. */
  ttlSeconds: number;
  /** needy release to run, `MAJOR.MINOR.PATCH`; it must match the daemon's. */
  version: string;
}

export interface AttachNeedyExecutorResult {
  attachmentId: string;
  /** ISO date after which the device stops the runner on its own. */
  expiresAt: string;
  /** `true` when a runner for this attachment was already running. */
  reused: boolean;
  runnerName: string;
  version: string;
}

export interface DetachNeedyExecutorParams {
  attachmentId: string;
}

export interface DetachNeedyExecutorResult {
  /** `false` when nothing was attached under this id; detaching twice is not an error. */
  detached: boolean;
}

/**
 * Why a device client that cannot host a needy executor refuses these RPCs.
 * Shared so the server can tell "unsupported" apart.
 */
export const NEEDY_EXECUTOR_UNSUPPORTED_MESSAGE =
  'This device client does not support needy executors';

/**
 * Prefix of every error the device's needy executor handlers return, so the
 * server can tell a device-side failure from a gateway / transport one.
 */
export const NEEDY_EXECUTOR_ERROR_PREFIX = 'Needy executor error:';
