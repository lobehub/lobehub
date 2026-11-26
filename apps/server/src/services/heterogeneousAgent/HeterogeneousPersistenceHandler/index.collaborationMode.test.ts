// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import { buildEvent, createHarness } from './testUtils';

const OP = 'op-1';
const TOPIC = 'topic-1';

describe('HeterogeneousPersistenceHandler — Codex Plan switch', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  it('writes nothing for a read-back that confirms the request', async () => {
    const h = createHarness({ assistantMessageId: 'asst-1', operationId: OP, topicId: TOPIC });

    await h.handler.ingest({
      events: [
        buildEvent('step_complete', 0, {
          collaborationMode: 'plan',
          phase: 'collaboration_mode',
          requested: 'plan',
        }),
      ],
      operationId: OP,
      topicId: TOPIC,
    });

    expect(h.topicModel.updateMetadata).not.toHaveBeenCalled();
  });

  it('follows Codex when it disagrees with what the run asked for', async () => {
    const h = createHarness({ assistantMessageId: 'asst-1', operationId: OP, topicId: TOPIC });

    await h.handler.ingest({
      events: [
        buildEvent('step_complete', 0, {
          collaborationMode: 'default',
          phase: 'collaboration_mode',
          requested: 'plan',
        }),
      ],
      operationId: OP,
      topicId: TOPIC,
    });

    expect(h.topicModel.updateMetadata).toHaveBeenCalledWith(TOPIC, { heteroPlanMode: false });
  });
});
