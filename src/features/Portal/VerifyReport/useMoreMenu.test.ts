import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVerifyReportMoreMenu } from './useMoreMenu';

const mocks = vi.hoisted(() => ({
  allowed: true,
  isOwner: true,
}));

vi.mock('@/components/RenameModal', () => ({ openRenameModal: vi.fn() }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: mocks.allowed }) }));
vi.mock('@/libs/swr', () => ({ mutate: vi.fn() }));
vi.mock('@/services/verify', () => ({ verifyService: { updateRunTitle: vi.fn() } }));
vi.mock('./useReportUrl', () => ({
  useVerifyReportUrl: () => ({ reportUrl: 'https://app.lobehub.com/verify/run_1', runId: 'run_1' }),
}));
vi.mock('@/features/Acceptance/hooks', () => ({
  useVerifyReportBundle: () => ({
    data: { isOwner: mocks.isOwner, report: null, results: [], run: { title: 'Run' } },
  }),
}));

describe('useVerifyReportMoreMenu', () => {
  beforeEach(() => {
    mocks.allowed = true;
    mocks.isOwner = true;
  });

  it('offers rename to the author of the run', () => {
    const { result } = renderHook(() => useVerifyReportMoreMenu());

    expect(result.current?.rename).toBeTypeOf('function');
  });

  it('hides rename on a public report opened by someone else', () => {
    mocks.isOwner = false;
    const { result } = renderHook(() => useVerifyReportMoreMenu());

    expect(result.current?.rename).toBeUndefined();
    expect(result.current).toMatchObject({
      copyId: 'run_1',
      copyLink: 'https://app.lobehub.com/verify/run_1',
    });
  });
});
