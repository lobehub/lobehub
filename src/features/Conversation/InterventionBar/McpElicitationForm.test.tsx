// @vitest-environment happy-dom
import { MCP_CONTINUATION_CONTROL } from '@lobechat/mcp-elicitation/types';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { PendingMcpElicitation } from '@/services/mcpElicitation';

import { McpElicitationForm } from './McpElicitationForm';

const probes = vi.hoisted(() => ({ resolve: vi.fn(), refresh: vi.fn(), mutate: vi.fn() }));
vi.mock('@/services/mcpElicitation', () => ({
  mcpElicitationService: { resolve: probes.resolve },
}));
vi.mock('@/libs/swr', () => ({ mutate: probes.mutate }));
vi.mock('@/store/chat', () => ({
  useChatStore: (select: any) => select({ refreshMessages: probes.refresh }),
}));
vi.mock('@/store/user', () => ({ useUserStore: (select: any) => select({ userId: 'owner' }) }));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: (s: any) => s.userId },
}));
vi.mock('../store', () => ({
  useConversationStore: (select: any) => select({ context: { topicId: 'topic' } }),
}));
vi.mock('../hooks/useConversationResourceAccess', () => ({
  useConversationResourceAccess: () => ({ canUseResource: true }),
}));
vi.mock('../hooks/useFetchMcpElicitations', () => ({ useFetchMcpElicitations: () => ({}) }));
vi.mock('@/services/electron/system', () => ({ electronSystemService: {} }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts: any) => (opts?.field ? `Omit ${opts.field}` : key),
  }),
}));
const pending = (
  requests: PendingMcpElicitation['requests'],
  batchId = 'batch',
): PendingMcpElicitation => ({
  id: batchId,
  batchId,
  deadline: Date.now() + 10000,
  identifier: 'fixture',
  apiName: 'form',
  assistantMessageId: 'assistant',
  operationId: 'op',
  toolCallId: 'call',
  toolMessageId: 'tool',
  resolving: false,
  requests,
});
const form = {
  mode: 'form' as const,
  message: 'Input',
  requestedSchema: {
    type: 'object' as const,
    required: ['enabled', 'empty', 'zero'],
    properties: {
      enabled: { type: 'boolean' as const },
      empty: { type: 'string' as const },
      zero: { type: 'number' as const, default: 0 },
      optional: { type: 'string' as const },
      defaulted: { type: 'string' as const, default: 'seed' },
    },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  probes.resolve.mockResolvedValue({ state: 'resolved' });
});
afterEach(cleanup);
it('submits false, zero, legal empty input and defaults without forcing a toggle; optional may stay absent or be explicitly omitted', async () => {
  const view = render(<McpElicitationForm pending={pending({ input: form })} />);
  fireEvent.change(view.getByLabelText('empty *'), { target: { value: 'temporary' } });
  fireEvent.change(view.getByLabelText('empty *'), { target: { value: '' } });
  fireEvent.change(view.getByRole('textbox', { name: 'zero *' }), { target: { value: '4' } });
  fireEvent.blur(view.getByRole('textbox', { name: 'zero *' }));
  fireEvent.change(view.getByRole('textbox', { name: 'zero *' }), { target: { value: '0' } });
  fireEvent.blur(view.getByRole('textbox', { name: 'zero *' }));
  fireEvent.change(view.getByLabelText('optional'), { target: { value: 'temporary' } });
  fireEvent.click(view.getByRole('button', { name: 'Omit optional' }));
  fireEvent.click(view.getByRole('button', { name: 'mcpElicitation.accept' }));
  await waitFor(() => expect(probes.resolve).toHaveBeenCalledOnce());
  expect(probes.resolve.mock.calls[0][2]).toEqual({
    input: { action: 'accept', content: { enabled: false, empty: '', zero: 0, defaulted: 'seed' } },
  });
});
it('allows explicit cancellation of requestState-only waits', async () => {
  const view = render(<McpElicitationForm pending={pending({})} />);
  fireEvent.click(view.getByRole('button', { name: 'mcpElicitation.cancel' }));
  await waitFor(() => expect(probes.resolve).toHaveBeenCalledOnce());
  expect(probes.resolve.mock.calls[0][2]).toEqual({
    [MCP_CONTINUATION_CONTROL]: { action: 'cancel' },
  });
});
it('retries a requestState-only wait without inventing form data', async () => {
  const view = render(<McpElicitationForm pending={pending({})} />);
  fireEvent.click(view.getByRole('button', { name: 'mcpElicitation.retry' }));
  await waitFor(() => expect(probes.resolve).toHaveBeenCalledOnce());
  expect(probes.resolve.mock.calls[0][2]).toEqual({
    [MCP_CONTINUATION_CONTROL]: { action: 'accept' },
  });
});
it('resets requestIndex, partial answers and form state at every batch boundary', async () => {
  const simple = (name: string) => ({
    mode: 'form' as const,
    message: name,
    requestedSchema: {
      type: 'object' as const,
      properties: { [name]: { type: 'string' as const } },
      required: [name],
    },
  });
  const view = render(
    <McpElicitationForm pending={pending({ one: simple('first'), two: simple('second') })} />,
  );
  fireEvent.change(view.getByLabelText('first *'), { target: { value: 'old-answer' } });
  fireEvent.click(view.getByRole('button', { name: 'mcpElicitation.next' }));
  expect(view.getByLabelText('second *')).toBeTruthy();
  view.rerender(<McpElicitationForm pending={pending({ new: simple('newField') }, 'new-batch')} />);
  fireEvent.change(view.getByLabelText('newField *'), { target: { value: 'new-answer' } });
  fireEvent.click(view.getByRole('button', { name: 'mcpElicitation.accept' }));
  await waitFor(() => expect(probes.resolve).toHaveBeenCalledOnce());
  expect(probes.resolve.mock.calls[0][0]).toBe('new-batch');
  expect(probes.resolve.mock.calls[0][2]).toEqual({
    new: { action: 'accept', content: { newField: 'new-answer' } },
  });
});
