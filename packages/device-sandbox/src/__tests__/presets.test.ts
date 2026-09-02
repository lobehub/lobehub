import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeSandboxPolicy } from '../policy';
import { createLocalSandboxPolicy, LOCAL_SANDBOX_NETWORK_DOMAINS } from '../presets';

describe('createLocalSandboxPolicy', () => {
  it('confines writes to the working directory and the temp dir', () => {
    const policy = createLocalSandboxPolicy(process.cwd());

    expect(policy.writableRoots).toEqual([process.cwd(), os.tmpdir()]);
  });

  it('denies network with no allowlist by default', () => {
    // `normalizeSandboxPolicy` throws when `allowNetwork` is set without a
    // non-empty domain allowlist, so a policy that accidentally opened the
    // network would fail here rather than at the user's machine.
    const policy = createLocalSandboxPolicy(process.cwd());

    expect(policy.allowNetwork).toBe(false);
    expect(policy.allowedNetworkDomains).toBeUndefined();
    expect(() => normalizeSandboxPolicy(policy)).not.toThrow();
  });

  it('opens only the registry allowlist when network is allowed', () => {
    const policy = createLocalSandboxPolicy(process.cwd(), { allowNetwork: true });

    expect(policy.allowNetwork).toBe(true);
    expect(policy.allowedNetworkDomains).toEqual([...LOCAL_SANDBOX_NETWORK_DOMAINS]);
    expect(() => normalizeSandboxPolicy(policy)).not.toThrow();
  });

  it('keeps every allowlist entry within what the backend accepts', () => {
    // The sandbox backend rejects a bare `*` and overly broad patterns like
    // `*.com` outright, so a careless addition here would make every network
    // -enabled run fail at config validation instead of at review.
    for (const domain of LOCAL_SANDBOX_NETWORK_DOMAINS) {
      expect(domain).not.toBe('*');
      expect(domain).toContain('.');
      expect(domain.startsWith('*.') ? domain.slice(2) : domain).toContain('.');
      // no wildcard anywhere except a leading `*.`
      expect(domain.replace(/^\*\./, '')).not.toContain('*');
    }
  });

  it('fails closed when no sandbox backend is available', () => {
    // The whole point of the option: an unavailable backend must abort the
    // command, never downgrade it to an unsandboxed spawn.
    expect(createLocalSandboxPolicy(process.cwd()).onUnavailable).toBe('deny');
  });

  it('leaves reads unrestricted', () => {
    // Commands legitimately read toolchains outside the project (node, rustup,
    // Homebrew). The promise is "can't modify anything outside the working
    // directory", not "can't see anything".
    const policy = createLocalSandboxPolicy(process.cwd());

    expect(policy.deniedReadRoots).toBeUndefined();
    expect(policy.readableRoots).toBeUndefined();
  });
});

describe('createLocalSandboxPolicy overlay', () => {
  it('adds admin-configured writable roots to, not instead of, cwd/tmpdir', () => {
    const policy = createLocalSandboxPolicy(process.cwd(), {
      overlay: { writableRoots: [os.tmpdir()] },
    });

    // os.tmpdir() overlaps with the always-present default, so the Set
    // dedupes it rather than doubling the entry.
    expect(policy.writableRoots).toEqual([process.cwd(), os.tmpdir()]);
  });

  it('expands a leading ~ against the real home directory', () => {
    const policy = createLocalSandboxPolicy(process.cwd(), {
      overlay: { deniedWriteRoots: ['~/.ssh'], writableRoots: ['~/Downloads'] },
    });

    expect(policy.writableRoots).toContain(path.join(os.homedir(), 'Downloads'));
    expect(policy.deniedWriteRoots).toEqual([path.join(os.homedir(), '.ssh')]);
  });

  it('leaves deniedReadRoots/deniedWriteRoots/readableRoots unset with no overlay', () => {
    const policy = createLocalSandboxPolicy(process.cwd(), { overlay: {} });

    expect(policy.deniedReadRoots).toBeUndefined();
    expect(policy.deniedWriteRoots).toBeUndefined();
    expect(policy.readableRoots).toBeUndefined();
    expect(policy.envAllowlist).toBeUndefined();
  });

  it('replaces (not extends) the network allowlist when the overlay sets one', () => {
    const policy = createLocalSandboxPolicy(process.cwd(), {
      allowNetwork: true,
      overlay: { allowedNetworkDomains: ['*.internal.example.com'] },
    });

    expect(policy.allowedNetworkDomains).toEqual(['*.internal.example.com']);
  });

  it('falls back to the default registry allowlist when the overlay sets no domains', () => {
    const policy = createLocalSandboxPolicy(process.cwd(), {
      allowNetwork: true,
      overlay: { writableRoots: ['~/Downloads'] },
    });

    expect(policy.allowedNetworkDomains).toEqual([...LOCAL_SANDBOX_NETWORK_DOMAINS]);
  });

  it('never opens the network from the overlay alone — allowNetwork still gates it', () => {
    const policy = createLocalSandboxPolicy(process.cwd(), {
      allowNetwork: false,
      overlay: { allowedNetworkDomains: ['*.internal.example.com'] },
    });

    expect(policy.allowNetwork).toBe(false);
    expect(policy.allowedNetworkDomains).toBeUndefined();
  });
});
