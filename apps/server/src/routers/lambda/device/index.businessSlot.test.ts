// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type * as lambdaTrpc from '@/libs/trpc/lambda';

import { deviceRouter } from '.';

vi.mock('@/business/server/lambda-routers/device', async () => {
  const { publicProcedure, router } =
    await vi.importActual<typeof lambdaTrpc>('@/libs/trpc/lambda');
  return {
    businessDeviceRouter: router({
      businessSlotProbe: publicProcedure.query(() => 'probe'),
    }),
  };
});

describe('deviceRouter business slot', () => {
  it('merges the procedures of the business device router', () => {
    const procedures = (deviceRouter as any)._def.procedures as Record<string, any>;

    expect(procedures.businessSlotProbe?._def.type).toBe('query');
  });
});
