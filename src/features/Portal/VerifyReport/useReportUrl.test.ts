import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVerifyReportUrl } from './useReportUrl';

const mocks = vi.hoisted(() => ({
  bundle: undefined as { run: Record<string, unknown> } | undefined,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => 'lobe-team',
}));
vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://app.lobehub.com' }));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: { verifyReportRunId: () => 'run_1' },
}));
vi.mock('@/features/Acceptance/hooks', () => ({
  useVerifyReportBundle: () => ({ data: mocks.bundle }),
}));

describe('useVerifyReportUrl', () => {
  beforeEach(() => {
    mocks.bundle = undefined;
  });

  // The workspace-prefixed route is gated on membership, so the copied link stays
  // on the public route even inside a workspace.
  it('links a run in an acceptance to its public round URL inside a workspace', () => {
    mocks.bundle = { run: { acceptanceId: 'acc_1', roundIndex: 2 } };
    const { result } = renderHook(() => useVerifyReportUrl());

    expect(result.current).toEqual({
      externalUrl: 'https://app.lobehub.com/acceptance/acc_1?r=2',
      reportUrl: 'https://app.lobehub.com/acceptance/acc_1?r=2',
      runId: 'run_1',
      standalone: false,
    });
  });

  it('has no link for a run outside any acceptance', () => {
    mocks.bundle = { run: { acceptanceId: null, roundIndex: null } };
    const { result } = renderHook(() => useVerifyReportUrl());

    expect(result.current).toMatchObject({
      externalUrl: undefined,
      reportUrl: undefined,
      standalone: true,
    });
  });

  it('waits for the run before deciding it is standalone', () => {
    const { result } = renderHook(() => useVerifyReportUrl());

    expect(result.current).toMatchObject({ reportUrl: undefined, standalone: false });
  });
});
