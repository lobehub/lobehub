/**
 * Whether commands dispatched to this device run fenced, and who gets to say.
 *
 * The server already decides per run: the agent's execution environment sets
 * `sandbox` on the tool-call args, and the host is expected to honour it. That
 * covers "the person who configured the agent wants a fence". It does not cover
 * "the person who owns this machine wants a fence regardless of what any agent
 * asks for", which is the enterprise case — the two are different people, and
 * only the second one is standing next to the hardware.
 *
 * So this is a device-side setting layered over the per-run flag, and it is a
 * bound rather than a preference: it can only ever make the outcome stricter
 * than the run asked for, never looser. A device that could quietly turn a
 * `sandbox: true` run into an unfenced one would be an authority inversion —
 * the fence would be advisory, and advisory fences are worse than none because
 * the UI still promises one.
 */
export type CommandMode = 'auto' | 'host' | 'sandbox';

export const COMMAND_MODES: readonly CommandMode[] = ['auto', 'host', 'sandbox'];

/**
 * Not the default because sandboxing is undesirable — because it is not this
 * setting's job to have an opinion. `auto` honours the per-run flag exactly,
 * which is both the correct authority and the behaviour a device already had
 * before this setting existed.
 */
export const DEFAULT_COMMAND_MODE: CommandMode = 'auto';

/**
 * How much fencing each mode imposes, ordered so "stricter" is a comparison.
 *
 * `host` sits at the bottom because it applies no fence of its own — note that
 * it still *refuses* a run that asked to be fenced rather than downgrading it,
 * so being least-fencing is not the same as being least-safe. The ordering
 * exists for {@link mergeCommandMode}, and ranks the fence this device will
 * apply on its own initiative, nothing else.
 */
const STRICTNESS: Record<CommandMode, number> = { auto: 1, host: 0, sandbox: 2 };

export const isCommandMode = (value: unknown): value is CommandMode =>
  typeof value === 'string' && (COMMAND_MODES as readonly string[]).includes(value);

export const parseCommandMode = (value: unknown): CommandMode | undefined =>
  isCommandMode(value) ? value : undefined;

/**
 * Combine the mode stored on this machine with one handed down by the server.
 *
 * Push-down may only tighten. A deployment can require its fleet to sandbox;
 * it cannot reach into a machine that chose to sandbox and turn that off. If
 * the relation were "last writer wins", the local file would stop being a
 * guarantee the moment the feature shipped — and every operator who set it
 * would have to re-audit their assumption without being told.
 *
 * Pinned by tests now, before any push-down channel exists, because changing
 * this rule later is a silent security downgrade rather than a visible break.
 */
export const mergeCommandMode = (local: CommandMode, pushed?: CommandMode): CommandMode =>
  pushed && STRICTNESS[pushed] > STRICTNESS[local] ? pushed : local;

export type SandboxDecision =
  | { allowNetwork: boolean; kind: 'sandbox' }
  | { kind: 'host' }
  | { kind: 'refused'; reason: string };

export interface DecideSandboxParams {
  /** This device's `sandboxNetwork` setting — consulted only when the device is the one imposing the fence. */
  deviceNetwork?: boolean;
  mode: CommandMode;
  /** The run's `sandbox` flag, as set by the server from the agent's execution environment. */
  requested?: boolean;
  /** The run's `sandboxNetwork` flag. Only meaningful when `requested` is true. */
  requestedNetwork?: boolean;
}

/**
 * Resolve one command's fencing from the run's request and this device's mode.
 *
 * The network answer follows whoever imposed the fence: if the run asked to be
 * sandboxed it also decided what the sandbox may reach, so its flag wins. Only
 * when this device fences a run that never asked does the device's own network
 * setting apply — otherwise `sandbox` mode would force every command onto a
 * network-less fence, which is the "then nothing works" failure that makes
 * operators turn the whole thing off.
 */
export const decideSandbox = ({
  deviceNetwork = false,
  mode,
  requested = false,
  requestedNetwork = false,
}: DecideSandboxParams): SandboxDecision => {
  if (mode === 'sandbox') {
    return { allowNetwork: requested ? requestedNetwork : deviceNetwork, kind: 'sandbox' };
  }

  if (mode === 'host') {
    // Refuse, never downgrade. The caller asked for a fence; running the
    // command anyway would answer a security question with a lie.
    if (requested) {
      return {
        kind: 'refused',
        reason:
          'This device is configured to run commands on the host, but this run requires the sandbox.',
      };
    }
    return { kind: 'host' };
  }

  return requested ? { allowNetwork: requestedNetwork, kind: 'sandbox' } : { kind: 'host' };
};
