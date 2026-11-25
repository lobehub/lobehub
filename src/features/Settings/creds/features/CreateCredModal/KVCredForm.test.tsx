import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type CredsApi } from '../useCredsApi';
import KVCredForm from './KVCredForm';

const renderForm = (props: Partial<Parameters<typeof KVCredForm>[0]>) => {
  const mutate = vi.fn().mockResolvedValue({});
  const credsApi = { client: { createKV: { mutate } } } as unknown as CredsApi;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <KVCredForm
        credsApi={credsApi}
        type={'kv-env'}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
  return mutate;
};

const fillAndSubmit = async (name?: string) => {
  if (name)
    fireEvent.change(screen.getByPlaceholderText('OpenAI API Key'), { target: { value: name } });
  const variable = screen.getAllByPlaceholderText('OPENAI_API_KEY')[0] as HTMLInputElement;
  if (!variable.value) fireEvent.change(variable, { target: { value: 'OPENAI_API_KEY' } });
  fireEvent.change(screen.getAllByPlaceholderText('creds.form.valuePlaceholder')[0], {
    target: { value: 'secret' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'creds.form.submit' }));
};

describe('KVCredForm', () => {
  it('lets the server derive the key when the person creates a credential', async () => {
    const mutate = renderForm({});
    await fillAndSubmit('OpenAI');

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0].key).toBeUndefined();
  });

  it('keeps a preset fixed key, which skills look the credential up by', async () => {
    const mutate = renderForm({
      preset: { key: 'github', keys: ['GITHUB_TOKEN'], name: 'GitHub' },
    });
    await fillAndSubmit();

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject({ key: 'github', name: 'GitHub' });
  });
});
