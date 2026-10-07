import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canSaveCredsInput,
  createCredsInputSubmit,
  type CredsWriteClient,
  saveCredsInput,
} from './saveCredsInput';

const values = { OPENAI_API_KEY: 'sk-test-secret-value' };

const args = {
  fieldNames: ['OPENAI_API_KEY'],
  key: 'openai',
  name: 'OpenAI API Key',
  type: 'kv-env' as const,
};

const createClient = (rows: Array<{ id: number; key: string; ownerType?: string }>) => ({
  createKV: { mutate: vi.fn().mockResolvedValue({ id: 1 }) },
  list: { query: vi.fn().mockResolvedValue({ data: rows }) },
  update: { mutate: vi.fn().mockResolvedValue({}) },
});

describe('saveCredsInput', () => {
  let client: ReturnType<typeof createClient>;

  beforeEach(() => {
    client = createClient([]);
  });

  it('creates a credential when the key is new', async () => {
    await saveCredsInput(client as CredsWriteClient, args, false, values);

    expect(client.createKV.mutate).toHaveBeenCalledWith({
      description: undefined,
      key: 'openai',
      name: 'OpenAI API Key',
      type: 'kv-env',
      values,
    });
    expect(client.update.mutate).not.toHaveBeenCalled();
  });

  it('overwrites the credential that already uses the key', async () => {
    client = createClient([{ id: 7, key: 'openai' }]);

    await saveCredsInput(client as CredsWriteClient, args, false, values);

    expect(client.update.mutate).toHaveBeenCalledWith({
      description: undefined,
      id: 7,
      name: 'OpenAI API Key',
      values,
    });
    expect(client.createKV.mutate).not.toHaveBeenCalled();
  });

  it('never overwrites a member’s shared credential from the workspace scope', async () => {
    client = createClient([{ id: 9, key: 'openai', ownerType: 'user' }]);

    await saveCredsInput(client as CredsWriteClient, args, true, values);

    expect(client.update.mutate).not.toHaveBeenCalled();
    expect(client.createKV.mutate).toHaveBeenCalledTimes(1);
  });

  it('overwrites the workspace’s own credential with the key', async () => {
    client = createClient([{ id: 3, key: 'openai', ownerType: 'organization' }]);

    await saveCredsInput(client as CredsWriteClient, args, true, values);

    expect(client.update.mutate).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });

  it('propagates store failures so the form stays open', async () => {
    client.createKV.mutate.mockRejectedValue(new Error('Failed to create KV credential'));

    await expect(saveCredsInput(client as CredsWriteClient, args, false, values)).rejects.toThrow();
  });
});

describe('canSaveCredsInput', () => {
  it('always allows personal credentials', () => {
    expect(canSaveCredsInput({ canManageWorkspaceCreds: false, isWorkspace: false })).toBe(true);
  });

  it('requires the credential-management permission inside a workspace', () => {
    expect(canSaveCredsInput({ canManageWorkspaceCreds: true, isWorkspace: true })).toBe(true);
    expect(canSaveCredsInput({ canManageWorkspaceCreds: false, isWorkspace: true })).toBe(false);
  });
});

describe('createCredsInputSubmit', () => {
  it('saves, then approves', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const approve = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    await createCredsInputSubmit({ approve, onError, save })(values);

    expect(save).toHaveBeenCalledWith(values);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not approve when the save fails', async () => {
    const save = vi.fn().mockRejectedValue(new Error('store unavailable'));
    const approve = vi.fn();
    const onError = vi.fn();

    await expect(createCredsInputSubmit({ approve, onError, save })(values)).rejects.toThrow();

    expect(onError).toHaveBeenCalledWith('save');
    expect(approve).not.toHaveBeenCalled();
  });

  it('reports a failed approval and retries it without writing the secret again', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const approve = vi
      .fn()
      .mockRejectedValueOnce(new Error('resume failed'))
      .mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const submit = createCredsInputSubmit({ approve, onError, save });

    await expect(submit(values)).rejects.toThrow();
    expect(onError).toHaveBeenCalledWith('approve');

    await submit(values);

    expect(save).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it('writes edited values before retrying a failed approval', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const approve = vi
      .fn()
      .mockRejectedValueOnce(new Error('resume failed'))
      .mockResolvedValueOnce(undefined);
    const submit = createCredsInputSubmit({ approve, onError: vi.fn(), save });

    await expect(submit(values)).rejects.toThrow();

    const edited = { OPENAI_API_KEY: 'sk-test-edited-value' };
    await submit(edited);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(edited);
    expect(approve).toHaveBeenCalledTimes(2);
  });
});
