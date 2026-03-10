import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialsExecutionRuntime } from './index';

describe('CredentialsExecutionRuntime', () => {
  const service = {
    deleteCredential: vi.fn(),
    getCredential: vi.fn(),
    listCredentials: vi.fn(),
    setCredential: vi.fn(),
  };

  const runtime = new CredentialsExecutionRuntime({ service });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('setCredential should validate path and persist value', async () => {
    service.setCredential.mockResolvedValue(undefined);

    const result = await runtime.setCredential({
      path: 'sandboxEnv.MOLTBOOK_API_KEY',
      value: 'abc',
    });

    expect(result.success).toBe(true);
    expect(service.setCredential).toHaveBeenCalledWith('sandboxEnv.MOLTBOOK_API_KEY', 'abc');
  });

  it('getCredential should return masked value by default', async () => {
    service.getCredential.mockResolvedValue('moltbook_xxx_1234');

    const result = await runtime.getCredential({ path: 'sandboxEnv.MOLTBOOK_API_KEY' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Credential exists');
    expect(result.content).not.toContain('moltbook_xxx_1234');
  });

  it('listCredentials should apply prefix filter in service response', async () => {
    service.listCredentials.mockResolvedValue([
      { path: 'sandboxEnv.MOLTBOOK_API_KEY', value: 'abc' },
      { path: 'sandboxEnv.GITHUB_TOKEN', value: 'def' },
    ]);

    const result = await runtime.listCredentials({ prefix: 'sandboxEnv' });

    expect(result.success).toBe(true);
    expect(service.listCredentials).toHaveBeenCalledWith('sandboxEnv');
    expect(result.content).toContain('sandboxEnv.MOLTBOOK_API_KEY');
  });

  it('deleteCredential should report deleted state', async () => {
    service.deleteCredential.mockResolvedValue(true);

    const result = await runtime.deleteCredential({ path: 'sandboxEnv.MOLTBOOK_API_KEY' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('deleted');
    expect(service.deleteCredential).toHaveBeenCalledWith('sandboxEnv.MOLTBOOK_API_KEY');
  });
});
