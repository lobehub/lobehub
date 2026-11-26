import { describe, expect, it, vi } from 'vitest';

import { expectPermissionModeReport, settlePermissionModeReport } from './permissionModeReport';

const topicModel = (metadata: Record<string, unknown> = {}) => ({
  findById: vi.fn(async () => ({ metadata })),
  updateMetadata: vi.fn(async () => {}),
});

describe('expectPermissionModeReport', () => {
  it('owes a report only for a mode that asks', async () => {
    const model = topicModel();
    await expectPermissionModeReport(model as any, {
      mode: 'plan',
      operationId: 'op',
      topicId: 't',
    });
    expect(model.updateMetadata).toHaveBeenCalledWith('t', {
      heteroPermissionModeReportPending: 'op',
    });

    const quiet = topicModel();
    await expectPermissionModeReport(quiet as any, {
      mode: 'bypassPermissions',
      operationId: 'op',
      topicId: 't',
    });
    await expectPermissionModeReport(quiet as any, { operationId: 'op', topicId: 't' });
    expect(quiet.updateMetadata).not.toHaveBeenCalled();
  });
});

describe('settlePermissionModeReport', () => {
  it('flags an lh that ran a clean turn without reporting the mode', async () => {
    const model = topicModel({ heteroPermissionModeReportPending: 'op' });
    await settlePermissionModeReport(model as any, {
      operationId: 'op',
      succeeded: true,
      topicId: 't',
    });
    expect(model.updateMetadata).toHaveBeenCalledWith('t', {
      heteroPermissionModeFallback: 'outdatedCli',
      heteroPermissionModeReportPending: null,
    });
  });

  it('only clears the marker after a failed run, and leaves a reported run alone', async () => {
    const failed = topicModel({ heteroPermissionModeReportPending: 'op' });
    await settlePermissionModeReport(failed as any, {
      operationId: 'op',
      succeeded: false,
      topicId: 't',
    });
    expect(failed.updateMetadata).toHaveBeenCalledWith('t', {
      heteroPermissionModeReportPending: null,
    });

    const reported = topicModel({ heteroPermissionModeReportPending: null });
    await settlePermissionModeReport(reported as any, {
      operationId: 'op',
      succeeded: true,
      topicId: 't',
    });
    expect(reported.updateMetadata).not.toHaveBeenCalled();
  });
});
