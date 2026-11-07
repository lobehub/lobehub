import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectDetail } from '@/store/project';

import { useGeneralSettingsForm, useSaveProjectField } from './useProjectGeneralSettings';

const mocks = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  updateProject: vi.fn(),
  uploadWithProgress: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({ confirmModal: mocks.confirmModal, toast: mocks.toast }));
vi.mock('@/store/file', () => ({
  useFileStore: (selector: (s: unknown) => unknown) =>
    selector({ uploadWithProgress: mocks.uploadWithProgress }),
}));
vi.mock('@/store/project', () => ({
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector({ updateProject: mocks.updateProject }),
}));

const project = {
  avatar: null,
  id: 'prj_1',
  name: 'Alpha',
} as unknown as ProjectDetail['project'];

describe('useSaveProjectField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('saves only the patched field and resolves to the saved project', async () => {
    mocks.updateProject.mockResolvedValue({ ...project, name: 'Beta' });
    const { result } = renderHook(() => useSaveProjectField('prj_1'));

    let saved: unknown;
    await act(async () => {
      saved = await result.current.save({ name: 'Beta' });
    });

    expect(mocks.updateProject).toHaveBeenCalledWith('prj_1', { name: 'Beta' });
    expect(saved).toMatchObject({ name: 'Beta' });
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.saved');
  });

  it('reports a failed save and resolves to undefined', async () => {
    mocks.updateProject.mockRejectedValue(new Error('conflict'));
    const { result } = renderHook(() => useSaveProjectField('prj_1'));

    let saved: unknown = 'unset';
    await act(async () => {
      saved = await result.current.save({ slug: 'taken' });
    });

    expect(saved).toBeUndefined();
    expect(mocks.toast.error).toHaveBeenCalledWith('settings.saveFailed');
    expect(result.current.saving).toBe(false);
  });
});

describe('useGeneralSettingsForm', () => {
  const current = project as unknown as ProjectDetail['project'];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProject.mockResolvedValue({ id: 'prj_1', slug: 'alpha' });
  });

  it('keeps a picked logo in the draft until saved', async () => {
    const { result } = renderHook(() => useGeneralSettingsForm(current));

    await act(async () => {
      result.current.logo.onChange('🚀');
    });

    expect(result.current.draft.avatar).toBe('🚀');
    expect(result.current.count).toBe(1);
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it('puts an uploaded file in the draft by its stored URL, not the data URL preview', async () => {
    mocks.uploadWithProgress.mockResolvedValue({ url: 'https://cdn/logo.png' });
    const { result } = renderHook(() => useGeneralSettingsForm(current));
    const file = new File(['x'], 'logo.png', { type: 'image/png' });

    await act(async () => {
      result.current.logo.onChange('data:image/png;base64,eA==');
      await result.current.logo.onUpload(file);
    });

    expect(result.current.draft.avatar).toBe('https://cdn/logo.png');
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it('saves every change in one update without asking and resolves to the saved project', async () => {
    const { result } = renderHook(() => useGeneralSettingsForm(current));

    act(() => {
      result.current.setField('name', 'Beta');
      result.current.setField('description', 'Relaunch');
    });
    let saved: unknown;
    await act(async () => {
      saved = await result.current.save();
    });

    expect(mocks.confirmModal).not.toHaveBeenCalled();
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    expect(mocks.updateProject).toHaveBeenCalledWith('prj_1', {
      description: 'Relaunch',
      name: 'Beta',
    });
    expect(saved).toEqual({ id: 'prj_1', slug: 'alpha' });
  });

  it('reverts the draft to the saved project', () => {
    const { result } = renderHook(() => useGeneralSettingsForm(current));

    act(() => result.current.setField('name', 'Beta'));
    expect(result.current.count).toBe(1);
    act(() => result.current.revert());

    expect(result.current.count).toBe(0);
    expect(result.current.draft.name).toBe('Alpha');
  });
});
