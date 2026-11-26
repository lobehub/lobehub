// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOperationStatesForTesting } from '.';
import { buildEvent, createHarness } from './testUtils';

const OP = 'op-1';
const TOPIC = 'topic-1';

describe('HeterogeneousPersistenceHandler — Claude Code permission mode', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  it('writes each mode Claude Code reports back to the topic', async () => {
    const h = createHarness({ assistantMessageId: 'asst-1', operationId: OP, topicId: TOPIC });

    await h.handler.ingest({
      events: [
        buildEvent('step_complete', 0, {
          fallback: null,
          permissionMode: 'plan',
          phase: 'permission_mode',
        }),
        buildEvent('stream_start', 1, { model: 'claude-opus' }),
        // Approving the plan: Claude Code switched itself.
        buildEvent('step_complete', 2, {
          fallback: null,
          permissionMode: 'acceptEdits',
          phase: 'permission_mode',
        }),
      ],
      operationId: OP,
      topicId: TOPIC,
    });

    expect(h.topicModel.updateMetadata.mock.calls).toEqual([
      [
        TOPIC,
        {
          heteroPermissionMode: 'plan',
          heteroPermissionModeFallback: null,
          heteroPermissionModeReportPending: null,
        },
      ],
      [
        TOPIC,
        {
          heteroPermissionMode: 'acceptEdits',
          heteroPermissionModeFallback: null,
          heteroPermissionModeReportPending: null,
        },
      ],
    ]);
  });

  it('records why a root run is not in the picked mode, keeping the pick', async () => {
    const h = createHarness({ assistantMessageId: 'asst-1', operationId: OP, topicId: TOPIC });
    await h.handler.ingest({
      events: [
        buildEvent('step_complete', 0, {
          fallback: 'root',
          permissionMode: 'acceptEdits',
          phase: 'permission_mode',
        }),
      ],
      operationId: OP,
      topicId: TOPIC,
    });
    expect(h.topicModel.updateMetadata).toHaveBeenCalledWith(TOPIC, {
      heteroPermissionModeFallback: 'root',
      heteroPermissionModeReportPending: null,
    });
  });
});
