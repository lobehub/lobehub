// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLangfuseConfig } from '../langfuse';

afterEach(() => {
  delete process.env.LANGFUSE_TRACE_DATA;
  vi.resetModules();
});

describe('getLangfuseConfig', () => {
  it('should use userId:userId as default trace data mapping', () => {
    const config = getLangfuseConfig();

    expect(config.LANGFUSE_TRACE_DATA).toEqual({ userId: 'userId' });
  });

  it('should support mapping userId to email', () => {
    process.env.LANGFUSE_TRACE_DATA = 'userId:email';

    const config = getLangfuseConfig();

    expect(config.LANGFUSE_TRACE_DATA).toEqual({ userId: 'email' });
  });

  it('should ignore invalid mapping values and keep default', () => {
    process.env.LANGFUSE_TRACE_DATA = 'userId:unknown_field';

    const config = getLangfuseConfig();

    expect(config.LANGFUSE_TRACE_DATA).toEqual({ userId: 'userId' });
  });

  it('should trim spaces around mapping fields', () => {
    process.env.LANGFUSE_TRACE_DATA = ' userId : email ';

    const config = getLangfuseConfig();

    expect(config.LANGFUSE_TRACE_DATA).toEqual({ userId: 'email' });
  });
});
