// @vitest-environment node
import type { UserCredSummary } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  findGitHubToken,
  resolveVaultGitHubToken,
  type VaultCredsReader,
  workspaceOwned,
} from './vaultGitHubToken';

const cred = (id: number, patch: Partial<UserCredSummary>): UserCredSummary => ({
  createdAt: '',
  id,
  key: `key-${id}`,
  name: `Cred ${id}`,
  type: 'kv-env',
  updatedAt: '',
  ...patch,
});

const reader = (
  creds: UserCredSummary[],
  plaintext: Record<number, Record<string, string>>,
): VaultCredsReader & { get: ReturnType<typeof vi.fn> } => ({
  get: vi.fn(async (id: number) => ({ plaintext: plaintext[id] })),
  list: async () => ({ data: creds }),
});

describe('findGitHubToken', () => {
  it('prefers the credential keyed github and reads GITHUB_TOKEN from it', async () => {
    const vault = reader([cred(1, { name: 'GitHub work' }), cred(2, { key: 'github' })], {
      1: { GITHUB_TOKEN: 'ghp_other' },
      2: { OTHER: 'x', GITHUB_TOKEN: ' ghp_main ' },
    });
    expect(await findGitHubToken(vault)).toBe('ghp_main');
    expect(vault.get).toHaveBeenCalledWith(2, { decrypt: true });
  });

  it('accepts GH_TOKEN, a single value of a GitHub-named credential, or a GitHub-prefixed value', async () => {
    expect(await findGitHubToken(reader([cred(1, { key: 'gh' })], { 1: { GH_TOKEN: 't1' } }))).toBe(
      't1',
    );
    expect(
      await findGitHubToken(reader([cred(1, { name: 'My GitHub' })], { 1: { TOKEN: 't2' } })),
    ).toBe('t2');
    expect(
      await findGitHubToken(
        reader([cred(1, { maskedPreview: 'github_pat_****abcd' })], { 1: { PAT: 'github_pat_x' } }),
      ),
    ).toBe('github_pat_x');
  });

  it('never decrypts unrelated, OAuth or file credentials', async () => {
    const vault = reader(
      [
        cred(1, { key: 'openai', maskedPreview: 'sk-****' }),
        cred(2, { key: 'github', type: 'oauth' }),
        cred(3, { key: 'github-key', type: 'file' }),
      ],
      {},
    );
    expect(await findGitHubToken(vault)).toBeUndefined();
    expect(vault.get).not.toHaveBeenCalled();
  });

  it('skips a credential that cannot be decrypted', async () => {
    const vault = reader([cred(1, { key: 'github' }), cred(2, { name: 'github 2' })], {
      2: { GITHUB_TOKEN: 'ghp_2' },
    });
    vault.get.mockRejectedValueOnce(new Error('forbidden'));
    expect(await findGitHubToken(vault)).toBe('ghp_2');
  });
});

describe('resolveVaultGitHubToken', () => {
  it('reads personal credentials before workspace ones and survives a failing Vault', async () => {
    const broken: VaultCredsReader = {
      get: vi.fn(),
      list: vi.fn().mockRejectedValue(new Error('market down')),
    };
    const personal = reader([cred(1, { key: 'github' })], { 1: { GITHUB_TOKEN: 'ghp_me' } });
    expect(await resolveVaultGitHubToken([broken, personal])).toBe('ghp_me');
  });

  it('uses only workspace-owned credentials that are not private', async () => {
    const org = reader(
      [
        cred(1, { key: 'github', ownerType: 'user' }),
        cred(2, { key: 'github', ownerType: 'organization', visibility: 'private' }),
        cred(3, { key: 'github', ownerType: 'organization', visibility: 'public' }),
      ],
      { 1: { GITHUB_TOKEN: 'a' }, 2: { GITHUB_TOKEN: 'b' }, 3: { GITHUB_TOKEN: 'c' } },
    );
    expect(await resolveVaultGitHubToken([workspaceOwned(org)])).toBe('c');
  });
});
