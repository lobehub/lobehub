import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectDetail } from '@/store/project';

import { useProjectLogo, useSaveProjectField } from './useProjectGeneralSettings';

const mocks = vi.hoisted(() => ({
  toast: { error: vi.fn(), success: vi.fn() },
  updateProject: vi.fn(),
  uploadWithProgress: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({ toast: mocks.toast }));
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

describe('useProjectLogo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProject.mockResolvedValue(project);
  });

  it('saves a picked logo straight away', async () => {
    const { result } = renderHook(() => useProjectLogo(project));

    await act(async () => {
      result.current.onChange('🚀');
    });

    expect(mocks.updateProject).toHaveBeenCalledWith('prj_1', { avatar: '🚀' });
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.logoUpdated');
  });

  it('saves a deleted logo as null, once', async () => {
    const { result } = renderHook(() => useProjectLogo({ ...project, avatar: '🚀' }));

    await act(async () => {
      // The picker reports the cleared value before calling onDelete.
      result.current.onChange(null);
      await result.current.onDelete();
    });

    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    expect(mocks.updateProject).toHaveBeenCalledWith('prj_1', { avatar: null });
  });

  it('saves an uploaded file by its stored URL, not the data URL preview', async () => {
    mocks.uploadWithProgress.mockResolvedValue({ url: 'https://cdn/logo.png' });
    const { result } = renderHook(() => useProjectLogo(project));
    const file = new File(['x'], 'logo.png', { type: 'image/png' });

    await act(async () => {
      result.current.onChange('data:image/png;base64,eA==');
      await result.current.onUpload(file);
    });

    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    expect(mocks.updateProject).toHaveBeenCalledWith('prj_1', { avatar: 'https://cdn/logo.png' });
  });

  it('does not save a logo that did not change', async () => {
    const { result } = renderHook(() => useProjectLogo({ ...project, avatar: '🚀' }));

    await act(async () => {
      result.current.onChange('🚀');
    });

    expect(mocks.updateProject).not.toHaveBeenCalled();
  });
});
