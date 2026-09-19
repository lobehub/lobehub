import { beforeEach, describe, expect, it } from 'vitest';

import { runCheck } from '../testUtils';
import { contextChecks } from './context';

describe('context.inherited', () => {
  beforeEach(() => {
    delete process.env.LOBEHUB_TOPIC_ID;
    delete process.env.LOBEHUB_OPERATION_ID;
    delete process.env.LOBEHUB_AGENT_ID;
    delete process.env.LOBEHUB_ASSISTANT_MESSAGE_ID;
  });

  it('passes in a clean shell', async () => {
    const outcome = await runCheck(contextChecks, 'context.inherited');

    expect(outcome.status).toBe('ok');
  });

  it('warns about inherited ids and shows how to strip them', async () => {
    process.env.LOBEHUB_TOPIC_ID = 'tpc_1';
    process.env.LOBEHUB_OPERATION_ID = 'op_1';

    const outcome = await runCheck(contextChecks, 'context.inherited');

    expect(outcome.status).toBe('warn');
    expect(outcome.fix).toContain('env -u LOBEHUB_TOPIC_ID -u LOBEHUB_OPERATION_ID lh <command>');
    expect(outcome.evidence).toEqual({ LOBEHUB_OPERATION_ID: 'op_1', LOBEHUB_TOPIC_ID: 'tpc_1' });
  });
});
