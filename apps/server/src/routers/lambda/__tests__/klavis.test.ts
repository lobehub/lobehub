// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { AuthContext } from '@/libs/trpc/lambda/context';

import { lambdaRouter } from '../index';

describe('lambdaRouter klavis compatibility', () => {
  it('keeps the legacy getKlavisPlugins path as an unauthenticated noop', async () => {
    const caller = lambdaRouter.createCaller({ userId: null } satisfies AuthContext);

    await expect(caller.klavis.getKlavisPlugins()).resolves.toEqual([]);
  });
});
