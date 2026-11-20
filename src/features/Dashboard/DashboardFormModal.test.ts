import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dashboardService } from '@/services/dashboard';
import { useDashboardStore } from '@/store/dashboard';
import { initialState } from '@/store/dashboard/initialState';

import { openCreateDashboardModal } from './DashboardFormModal';

const modal = vi.hoisted(() => ({ content: undefined as ReactElement | undefined }));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createModal: ({ content }: { content: ReactElement }) => {
    modal.content = content;
  },
}));

vi.mock('@/libs/swr', () => ({ mutate: vi.fn(), useClientDataSWR: vi.fn() }));

vi.mock('@/services/dashboard', () => ({
  dashboardService: { addItem: vi.fn(), create: vi.fn() },
}));

/** What the form's submit button runs; the form closes the modal only when it resolves. */
const submit = (value: { description?: string; title: string }) =>
  (modal.content!.props as { onSubmit: (value: unknown) => Promise<void> }).onSubmit(value);

beforeEach(() => {
  vi.clearAllMocks();
  modal.content = undefined;
  useDashboardStore.setState(initialState);
});

describe('openCreateDashboardModal with a widget', () => {
  it('creates the board and places the widget in one server write', async () => {
    vi.mocked(dashboardService.create).mockResolvedValue({ id: 'd1', title: 'Ops' } as any);
    const onCreated = vi.fn();

    openCreateDashboardModal({ onCreated, widgetId: 'w1' });
    await submit({ title: 'Ops' });

    expect(dashboardService.create).toHaveBeenCalledTimes(1);
    expect(dashboardService.create).toHaveBeenCalledWith({ title: 'Ops', widgetId: 'w1' });
    expect(dashboardService.addItem).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith({ id: 'd1', title: 'Ops' });
  });

  it('fails the submit (keeping the modal open) when placement fails, with no separate placement', async () => {
    vi.mocked(dashboardService.create).mockRejectedValue(new Error('Widget not found'));
    const onCreated = vi.fn();

    openCreateDashboardModal({ onCreated, widgetId: 'w1' });
    await expect(submit({ title: 'Ops' })).rejects.toThrow('Widget not found');

    expect(onCreated).not.toHaveBeenCalled();
    expect(dashboardService.addItem).not.toHaveBeenCalled();
  });
});
