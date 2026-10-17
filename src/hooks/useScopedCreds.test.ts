import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CREDS_FOR_CONTEXT_SWR_KEY,
  PERSONAL_CREDS_SWR_KEY,
  useCredsForContext,
  usePersonalCreds,
} from './useScopedCreds';

const { mockUseClientDataSWR } = vi.hoisted(() => ({ mockUseClientDataSWR: vi.fn() }));

vi.mock('@/libs/swr', () => ({ mutate: vi.fn(), useClientDataSWR: mockUseClientDataSWR }));
vi.mock('@/libs/trpc/client', () => ({ lambdaClient: {} }));

describe('useScopedCreds', () => {
  beforeEach(() => {
    mockUseClientDataSWR.mockReset();
    mockUseClientDataSWR.mockReturnValue({ data: undefined, isLoading: false });
  });

  // `useClientDataSWR` adds the active workspace id to array keys; the raw TRPC
  // query key it replaces had no workspace dimension, so a list fetched in one
  // workspace kept being served after switching to another.
  it('fetches the run-scope list through the workspace-aware SWR hook', () => {
    renderHook(() => useCredsForContext());

    expect(mockUseClientDataSWR).toHaveBeenCalledWith(
      [CREDS_FOR_CONTEXT_SWR_KEY],
      expect.any(Function),
    );
  });

  it('skips the run-scope fetch when disabled', () => {
    renderHook(() => useCredsForContext(false));

    expect(mockUseClientDataSWR).toHaveBeenCalledWith(null, expect.any(Function));
  });

  it('fetches the personal list through the workspace-aware SWR hook', () => {
    renderHook(() => usePersonalCreds());

    expect(mockUseClientDataSWR).toHaveBeenCalledWith(
      [PERSONAL_CREDS_SWR_KEY],
      expect.any(Function),
    );
  });
});
