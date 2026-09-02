import os from 'node:os';
import path from 'node:path';

import type { SandboxPolicy } from './types';

/**
 * Domains reachable when a Local Sandbox run opts into network access.
 *
 * There is no "allow everything" to offer: SRT's schema rejects a bare `*` and
 * overly broad patterns like `*.com` outright, so network access is always
 * *some* allowlist. This is the smallest set that makes the common reason for
 * wanting the network at all — installing dependencies and talking to the
 * project's own forge — work.
 *
 * Wildcards match strict subdomains only, so an apex domain that is itself
 * contacted (`github.com`, `pypi.org`) is listed alongside its `*.` form.
 *
 * Deliberately excluded: model/API providers and anything that could carry data
 * out on the model's behalf. The point of the sandbox is that a command cannot
 * exfiltrate what it reads; a general-purpose egress hole would give that back.
 */
export const LOCAL_SANDBOX_NETWORK_DOMAINS = [
  // npm / yarn / pnpm
  '*.npmjs.org',
  '*.npmmirror.com',
  '*.yarnpkg.com',
  'npmjs.org',
  'registry.npmmirror.com',
  // Python
  '*.pypi.org',
  '*.pythonhosted.org',
  'pypi.org',
  // Rust
  '*.crates.io',
  'crates.io',
  // Go
  'proxy.golang.org',
  'sum.golang.org',
  // Ruby
  '*.rubygems.org',
  'rubygems.org',
  // source forges
  '*.github.com',
  '*.githubusercontent.com',
  '*.gitlab.com',
  'github.com',
  'gitlab.com',
] as const;

/**
 * Admin-configured, per-user overlay on top of the Local Sandbox default
 * (`packages/database`'s `user_execution_policies`, resolved server-side —
 * see `apps/server/src/services/governance/executionPolicy.ts`). Applied only
 * when the run is already fenced by Local Sandbox; it never changes whether a
 * run is sandboxed, only what the fence allows once it is.
 */
export interface LocalSandboxPolicyOverlay {
  /** Replaces {@link LOCAL_SANDBOX_NETWORK_DOMAINS} when network is allowed, rather than adding to it — the admin's list is the allowlist for this user. */
  allowedNetworkDomains?: readonly string[];
  deniedReadRoots?: readonly string[];
  deniedWriteRoots?: readonly string[];
  envAllowlist?: readonly string[];
  readableRoots?: readonly string[];
  /** Added to the always-present `[cwd, tmpdir]`, not a replacement of them. */
  writableRoots?: readonly string[];
}

export interface LocalSandboxPolicyOptions {
  /**
   * Allow the run to reach {@link LOCAL_SANDBOX_NETWORK_DOMAINS} (or, when
   * `overlay.allowedNetworkDomains` is set, that list instead). Everything
   * else stays blocked — this is never "the network is open".
   */
  allowNetwork?: boolean;
  overlay?: LocalSandboxPolicyOverlay;
}

/**
 * Expand a leading `~` the way a shell would — admin-authored policy roots are
 * typed by a human, and `~/…` is the natural way to write "this user's home".
 * Every other path is passed through untouched; `normalizeWritableRoots`
 * downstream is what actually validates it's an absolute, existing path.
 */
const expandHome = (root: string): string =>
  root === '~' || root.startsWith('~/') ? path.join(os.homedir(), root.slice(1)) : root;

/**
 * Policy for the desktop "Local Sandbox" execution environment — the option a
 * user picks in the execution-environment switcher to keep an agent's shell
 * commands inside the run's working directory.
 *
 * Deliberately narrow, because the picker promises exactly this and nothing
 * more:
 *
 * - **writes** are confined to the run's `cwd` plus the OS temp directory.
 *   Tooling that cannot write a temp file at all (compilers, package managers,
 *   `git`) fails in ways that read as product bugs, so temp is part of the
 *   contract rather than a leak the user has to discover.
 * - **reads** stay unrestricted. SRT's read denial is a separate axis
 *   (`deniedReadRoots`), and a blanket read jail would break every command that
 *   touches a toolchain outside the project (node_modules symlinks, rustup,
 *   Homebrew). "Can't modify anything outside the project" is the honest,
 *   enforceable promise; "can't see anything" is not.
 * - **network is denied by default**, and even when allowed it is only the
 *   package-registry allowlist above.
 *
 * `onUnavailable: 'deny'` is the whole point of the option: if SRT can't be
 * initialized on this host, the command must fail loudly. Silently running
 * unsandboxed would hand the user a security guarantee the process never
 * applied.
 */
export const createLocalSandboxPolicy = (
  cwd: string,
  { allowNetwork = false, overlay }: LocalSandboxPolicyOptions = {},
): SandboxPolicy => ({
  allowNetwork,
  onUnavailable: 'deny',
  writableRoots: [
    ...new Set([cwd, os.tmpdir(), ...(overlay?.writableRoots?.map(expandHome) ?? [])]),
  ],
  ...(allowNetwork
    ? {
        allowedNetworkDomains: overlay?.allowedNetworkDomains?.length
          ? [...overlay.allowedNetworkDomains]
          : [...LOCAL_SANDBOX_NETWORK_DOMAINS],
      }
    : {}),
  ...(overlay?.deniedReadRoots?.length
    ? { deniedReadRoots: overlay.deniedReadRoots.map(expandHome) }
    : {}),
  ...(overlay?.deniedWriteRoots?.length
    ? { deniedWriteRoots: overlay.deniedWriteRoots.map(expandHome) }
    : {}),
  ...(overlay?.readableRoots?.length
    ? { readableRoots: overlay.readableRoots.map(expandHome) }
    : {}),
  ...(overlay?.envAllowlist?.length ? { envAllowlist: [...overlay.envAllowlist] } : {}),
});
