import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BootErrorBoundary from './index';

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
  vi.restoreAllMocks();
});

describe('BootErrorBoundary', () => {
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
