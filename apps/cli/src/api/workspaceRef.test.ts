import { beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { findWorkspace, resolveWorkspaceRef } from './workspaceRef';

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));

vi.mock('./client', () => ({
  getTrpcClient: async () => ({ workspace: { list: { query: mockList } } }),
}));

const workspaces = [
  { id: 'ws_1', name: 'Acme', slug: 'acme' },
  // A slug that collides with another workspace's id must not shadow that id.
  { id: 'ws_2', name: 'Beta', slug: 'ws_1' },
];

describe('workspaceRef', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(workspaces);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
  });

  it('prefers an id match over a slug match', () => {
    expect(findWorkspace(workspaces, 'ws_1')?.name).toBe('Acme');
  });

  it('resolves a slug to its id', async () => {
    await expect(resolveWorkspaceRef('acme')).resolves.toBe('ws_1');
  });

  it('keeps an omitted value for the ambient scope without a lookup', async () => {
    await expect(resolveWorkspaceRef(undefined)).resolves.toBeUndefined();
    expect(mockList).not.toHaveBeenCalled();
  });

  // Credentials that cannot list workspaces keep the pre-slug behavior.
  it('passes the value through as an id when the lookup fails', async () => {
    mockList.mockRejectedValue(new Error('FORBIDDEN'));

    await expect(resolveWorkspaceRef('ws_x')).resolves.toBe('ws_x');
  });

  it('exits when nothing matches', async () => {
    await expect(resolveWorkspaceRef('nope')).rejects.toThrow('process.exit');
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('nope'));
  });
});
