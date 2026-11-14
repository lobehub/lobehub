import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImportLoginData } from './useImportLoginData';

const mocks = vi.hoisted(() => ({
  importBrowserLoginData: vi.fn(),
  previewBrowserLoginData: vi.fn(),
}));

vi.mock('@/services/electron/browserSidebar', () => ({
  electronBrowserSidebarService: {
    importBrowserLoginData: mocks.importBrowserLoginData,
    previewBrowserLoginData: mocks.previewBrowserLoginData,
  },
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const renderImport = (onImported = vi.fn()) =>
  renderHook(() => useImportLoginData(onImported), { wrapper });

describe('useImportLoginData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.previewBrowserLoginData.mockResolvedValue({
      domains: [
        { count: 3, domain: 'github.com' },
        { count: 1, domain: 'example.com' },
      ],
      profile: 'Default',
      success: true,
    });
  });

  it('previews the Edge profile by default', async () => {
    const { result } = renderImport();

    await waitFor(() => expect(result.current.isPreviewLoading).toBe(false));
    expect(mocks.previewBrowserLoginData).toHaveBeenCalledWith({ source: 'edge' });
    expect(result.current.domains).toHaveLength(2);
    expect(result.current.canImport).toBe(true);
  });

  it('imports every host and notifies the caller', async () => {
    const onImported = vi.fn();
    const importResult = {
      failedDomains: ['example.com'],
      importedCount: 3,
      importedDomainCount: 1,
      success: true,
    };
    mocks.importBrowserLoginData.mockResolvedValue(importResult);
    const { result } = renderImport(onImported);
    await waitFor(() => expect(result.current.canImport).toBe(true));

    await act(() => result.current.runImport());

    expect(mocks.importBrowserLoginData).toHaveBeenCalledWith({
      domains: undefined,
      profile: 'Default',
      source: 'edge',
    });
    expect(result.current.result).toEqual(importResult);
    expect(onImported).toHaveBeenCalledWith(importResult);
    // A finished import cannot be submitted twice.
    expect(result.current.canImport).toBe(false);
  });

  it('imports only the selected hosts and requires a selection', async () => {
    mocks.importBrowserLoginData.mockResolvedValue({ importedCount: 3, success: true });
    const { result } = renderImport();
    await waitFor(() => expect(result.current.canImport).toBe(true));

    act(() => result.current.setScope('selected'));
    expect(result.current.canImport).toBe(false);

    act(() => result.current.setSelectedDomains(['github.com']));
    await act(() => result.current.runImport());

    expect(mocks.importBrowserLoginData).toHaveBeenCalledWith({
      domains: ['github.com'],
      profile: 'Default',
      source: 'edge',
    });
  });

  it('imports from the profile the preview resolved, not the browser last used one', async () => {
    mocks.previewBrowserLoginData.mockResolvedValue({
      domains: [{ count: 2, domain: 'github.com' }],
      profile: 'Profile 2',
      success: true,
    });
    mocks.importBrowserLoginData.mockResolvedValue({ importedCount: 2, success: true });
    const { result } = renderImport();
    await waitFor(() => expect(result.current.canImport).toBe(true));

    await act(() => result.current.runImport());

    expect(mocks.importBrowserLoginData).toHaveBeenCalledWith({
      domains: undefined,
      profile: 'Profile 2',
      source: 'edge',
    });
  });

  it('blocks importing when the preview reports a locked profile', async () => {
    mocks.previewBrowserLoginData.mockResolvedValue({
      domains: [],
      errorCode: 'cookie_db_locked',
      success: false,
    });
    const { result } = renderImport();

    await waitFor(() => expect(result.current.preview?.errorCode).toBe('cookie_db_locked'));
    expect(result.current.canImport).toBe(false);
  });

  it('turns a rejected preview call into a readable error instead of loading forever', async () => {
    mocks.previewBrowserLoginData.mockRejectedValue(new Error('ipc closed'));
    const { result } = renderImport();

    await waitFor(() => expect(result.current.preview?.errorCode).toBe('unknown'));
    expect(result.current.isPreviewLoading).toBe(false);
    expect(result.current.canImport).toBe(false);
  });

  it('keeps the failure for display and does not notify on a failed import', async () => {
    const onImported = vi.fn();
    mocks.importBrowserLoginData.mockRejectedValue(new Error('ipc closed'));
    const { result } = renderImport(onImported);
    await waitFor(() => expect(result.current.canImport).toBe(true));

    await act(() => result.current.runImport());

    expect(result.current.result).toEqual({
      errorCode: 'unknown',
      importedCount: 0,
      success: false,
    });
    expect(onImported).not.toHaveBeenCalled();
  });

  it('switching the source resets the selection and the previous result', async () => {
    mocks.importBrowserLoginData.mockResolvedValue({ importedCount: 1, success: true });
    const { result } = renderImport();
    await waitFor(() => expect(result.current.canImport).toBe(true));
    act(() => result.current.setSelectedDomains(['github.com']));
    await act(() => result.current.runImport());

    act(() => result.current.setSource('chrome'));

    expect(result.current.source).toBe('chrome');
    expect(result.current.selectedDomains).toEqual([]);
    expect(result.current.result).toBeUndefined();
    await waitFor(() =>
      expect(mocks.previewBrowserLoginData).toHaveBeenCalledWith({ source: 'chrome' }),
    );
  });
});
