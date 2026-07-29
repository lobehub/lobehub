import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BootErrorBoundary from './index';

const BOOT_RELOAD_SESSION_KEY = 'lobe:boot:hard-reload-attempts';

const ThrowDuringRender = () => {
  throw new Error('initial boot failure');
};

const ThrowAfterMount = () => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(true);
  }, []);

  if (failed) throw new Error('boot failure');
  return null;
};

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('BootErrorBoundary', () => {
  it('clears reload attempts after a successful boot', () => {
    window.sessionStorage.setItem(BOOT_RELOAD_SESSION_KEY, '1');

    render(
      <BootErrorBoundary>
        <div>ready</div>
      </BootErrorBoundary>,
    );

    expect(window.sessionStorage.getItem(BOOT_RELOAD_SESSION_KEY)).toBeNull();
  });

  it('preserves the reload limit while initial error reporting is pending', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let resolveReport: (() => void) | undefined;
    const onError = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReport = resolve;
        }),
    );
    window.sessionStorage.setItem(BOOT_RELOAD_SESSION_KEY, '1');

    render(
      <BootErrorBoundary fallback={<div>boot fallback</div>} maxBootReloads={1} onError={onError}>
        <ThrowDuringRender />
      </BootErrorBoundary>,
    );

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(window.sessionStorage.getItem(BOOT_RELOAD_SESSION_KEY)).toBe('1');

    resolveReport?.();
    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        'BootErrorBoundary reached max reload attempts',
        expect.objectContaining({ attempts: 1, maxReloads: 1 }),
      ),
    );
    expect(window.sessionStorage.getItem(BOOT_RELOAD_SESSION_KEY)).toBe('1');
  });

  it('reports errors through the optional callback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn(async () => {});

    render(
      <BootErrorBoundary fallback={<div>boot fallback</div>} onError={onError}>
        <ThrowAfterMount />
      </BootErrorBoundary>,
    );

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(screen.getByText('boot fallback')).toBeInTheDocument();
  });

  it('handles rejected reporting callbacks after the app has mounted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reportError = new Error('reporting failed');
    const onError = vi.fn(async () => {
      throw reportError;
    });

    render(
      <BootErrorBoundary fallback={<div>boot fallback</div>} onError={onError}>
        <ThrowAfterMount />
      </BootErrorBoundary>,
    );

    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        'BootErrorBoundary onError callback failed',
        reportError,
      ),
    );
  });
});
