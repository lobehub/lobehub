import { describe, expect, it } from 'vitest';

import { buildLobeHubSessionEnv } from './sessionEnv';

describe('buildLobeHubSessionEnv', () => {
  it('echoes the conversation ids the child process can attribute its output to', () => {
    expect(
      buildLobeHubSessionEnv({ agentId: 'agt_1', operationId: 'op_1', topicId: 'tpc_1' }),
    ).toEqual({
      LOBEHUB_AGENT_ID: 'agt_1',
      LOBEHUB_OPERATION_ID: 'op_1',
      LOBEHUB_TOPIC_ID: 'tpc_1',
    });
  });

  it('omits an id that did not resolve rather than exporting an empty var', () => {
    // A var set to '' or 'undefined' reads as present to every consumer down the
    // chain — `lh` would stamp a report with a topic id that resolves to nothing.
    expect(
      buildLobeHubSessionEnv({ agentId: 'agt_1', operationId: null, topicId: undefined }),
    ).toEqual({ LOBEHUB_AGENT_ID: 'agt_1' });
  });

  it('is empty when the run carries no conversation at all', () => {
    expect(buildLobeHubSessionEnv({})).toEqual({});
  });
});
