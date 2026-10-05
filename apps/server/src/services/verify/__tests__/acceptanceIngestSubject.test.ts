// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

const findTaskTopicByTopicId = vi.fn();
const findTaskById = vi.fn();
const findAcceptanceBySubject = vi.fn();

vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn().mockImplementation(function () {
    return { findByTopicId: findTaskTopicByTopicId };
  }),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn().mockImplementation(function () {
    return { findById: findTaskById };
  }),
}));

vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn().mockImplementation(function () {
    return { findBySubject: findAcceptanceBySubject };
  }),
}));

/**
 * An agent publishing its own report inside a Task run only knows its topic
 * (`LOBEHUB_TOPIC_ID`). Ingest must land on the Task, or the Task page — which
 * reads the task-subject acceptance — shows no acceptance at all (T-631).
 */
describe('AcceptanceService.ensureForIngest', () => {
  let service: AcceptanceService;
  let ensureForSubject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    findTaskTopicByTopicId.mockReset();
    findTaskById.mockReset();
    findAcceptanceBySubject.mockReset().mockResolvedValue(null);
    service = new AcceptanceService({} as never, 'user', undefined);
    ensureForSubject = vi.fn().mockResolvedValue({ id: 'acc' });
    service.ensureForSubject = ensureForSubject as never;
  });

  it('folds a task run topic onto its task', async () => {
    findTaskTopicByTopicId.mockResolvedValue({ taskId: 'task_1', topicId: 'tpc_1' });
    findTaskById.mockResolvedValue({ automationMode: null, id: 'task_1' });

    await service.ensureForIngest('topic', 'tpc_1', { requirement: 'Drag to start' });

    expect(ensureForSubject).toHaveBeenCalledWith('task', 'task_1', {
      requirement: 'Drag to start',
    });
  });

  it('keeps a plain conversation topic as the subject', async () => {
    findTaskTopicByTopicId.mockResolvedValue(null);

    await service.ensureForIngest('topic', 'tpc_chat');

    expect(ensureForSubject).toHaveBeenCalledWith('topic', 'tpc_chat', undefined);
  });

  it('keeps a run topic that already owns an acceptance, so rounds are not split', async () => {
    findTaskTopicByTopicId.mockResolvedValue({ taskId: 'task_1', topicId: 'tpc_1' });
    findAcceptanceBySubject.mockResolvedValue({ id: 'acc_topic' });

    await service.ensureForIngest('topic', 'tpc_1');

    expect(findAcceptanceBySubject).toHaveBeenCalledWith('topic', 'tpc_1');
    expect(ensureForSubject).toHaveBeenCalledWith('topic', 'tpc_1', undefined);
  });

  it('leaves recurring task ticks on their own topic', async () => {
    findTaskTopicByTopicId.mockResolvedValue({ taskId: 'task_cron', topicId: 'tpc_tick' });
    findTaskById.mockResolvedValue({ automationMode: 'schedule', id: 'task_cron' });

    await service.ensureForIngest('topic', 'tpc_tick');

    expect(ensureForSubject).toHaveBeenCalledWith('topic', 'tpc_tick', undefined);
  });

  it('passes non-topic subjects through untouched', async () => {
    await service.ensureForIngest('standalone', 'sa_1', { title: 'Report' });

    expect(findTaskTopicByTopicId).not.toHaveBeenCalled();
    expect(ensureForSubject).toHaveBeenCalledWith('standalone', 'sa_1', { title: 'Report' });
  });
});
