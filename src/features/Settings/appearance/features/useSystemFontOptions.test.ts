import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { electronSystemService } from '@/services/electron/system';

import { APPLICATION_DEFAULT_FONT, useSystemFontOptions } from './useSystemFontOptions';

vi.mock('@/services/electron/system', () => ({
  electronSystemService: {
    getSystemFonts: vi.fn(),
    getSystemMonospaceFonts: vi.fn(),
  },
}));

const params = {
  defaultLabel: 'default',
  unavailableLabel: (font: string) => `${font} (unavailable)`,
};

beforeEach(() => {
  vi.mocked(electronSystemService.getSystemFonts).mockResolvedValue([
    { label: 'Georgia', value: 'Georgia' },
    { label: 'LXGW WenKai', value: '"LXGW WenKai"' },
  ]);
  vi.mocked(electronSystemService.getSystemMonospaceFonts).mockResolvedValue([
    { label: 'Menlo', value: 'Menlo' },
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useSystemFontOptions', () => {
  it('puts the default entry first and keeps the loaded fonts after it', async () => {
    const { result } = renderHook(() => useSystemFontOptions(params));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.options.map((o) => o.value)).toEqual([
      APPLICATION_DEFAULT_FONT,
      'Georgia',
      '"LXGW WenKai"',
    ]);
    expect(electronSystemService.getSystemMonospaceFonts).not.toHaveBeenCalled();
  });

  it('loads only monospace fonts when monospaceOnly is set', async () => {
    const { result } = renderHook(() => useSystemFontOptions({ ...params, monospaceOnly: true }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.options.map((o) => o.value)).toEqual([APPLICATION_DEFAULT_FONT, 'Menlo']);
    expect(electronSystemService.getSystemFonts).not.toHaveBeenCalled();
  });

  it('keeps every selected font that is not installed on this device', async () => {
    const { result } = renderHook(() =>
      useSystemFontOptions({ ...params, values: ['Gone Sans', 'Georgia', 'Lost Serif'] }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.options.slice(1, 3)).toEqual([
      { label: 'Gone Sans (unavailable)', value: 'Gone Sans' },
      { label: 'Lost Serif (unavailable)', value: 'Lost Serif' },
    ]);
    expect(result.current.options.filter((o) => o.value === 'Georgia')).toHaveLength(1);
  });

  it('reports a load failure while still offering the default entry', async () => {
    vi.mocked(electronSystemService.getSystemFonts).mockRejectedValue(new Error('nope'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useSystemFontOptions(params));

    await waitFor(() => expect(result.current.hasLoadError).toBe(true));

    expect(result.current.options).toEqual([{ label: 'default', value: APPLICATION_DEFAULT_FONT }]);
  });

  it('does not load system fonts when disabled', () => {
    const { result } = renderHook(() => useSystemFontOptions({ ...params, enabled: false }));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.options).toEqual([{ label: 'default', value: APPLICATION_DEFAULT_FONT }]);
    expect(electronSystemService.getSystemFonts).not.toHaveBeenCalled();
    expect(electronSystemService.getSystemMonospaceFonts).not.toHaveBeenCalled();
  });
});
