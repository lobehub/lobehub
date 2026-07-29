import type { ToolAfterCallContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillStoreExecutionRuntime } from '../ExecutionRuntime';
import { SkillStoreApiName, SkillStoreIdentifier } from '../types';
import { SkillStoreExecutor } from './index';

describe('SkillStoreExecutor.onAfterCall', () => {
  const notifyImported = vi.fn().mockResolvedValue(undefined);
  // Only `notifyImported` is exercised by onAfterCall; cast a minimal stub.
  const runtime = { notifyImported } as unknown as SkillStoreExecutionRuntime;
  const executor = new SkillStoreExecutor(runtime);

  const createCtx = (apiName: string, success: boolean): ToolAfterCallContext => ({
    apiName,
    identifier: SkillStoreIdentifier,
    params: {},
    result: { content: '', success },
  });

  beforeEach(() => {
    notifyImported.mockClear();
  });

  it('refreshes the skills list after a successful importSkill', async () => {
    await executor.onAfterCall(createCtx(SkillStoreApiName.importSkill, true));

    expect(notifyImported).toHaveBeenCalledTimes(1);
  });

  it('refreshes the skills list after a successful importFromMarket', async () => {
    await executor.onAfterCall(createCtx(SkillStoreApiName.importFromMarket, true));

    expect(notifyImported).toHaveBeenCalledTimes(1);
  });

  it('does not refresh for searchSkill', async () => {
    await executor.onAfterCall(createCtx(SkillStoreApiName.searchSkill, true));

    expect(notifyImported).not.toHaveBeenCalled();
  });

  it('does not refresh when the import failed', async () => {
    await executor.onAfterCall(createCtx(SkillStoreApiName.importSkill, false));

    expect(notifyImported).not.toHaveBeenCalled();
  });
});
