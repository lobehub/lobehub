import { describe, expect, it } from 'vitest';

import type { QuickNoteResource } from '@/services/quickNote';

import { sortResources } from './sortResources';

const createResource = (patch: Partial<QuickNoteResource>): QuickNoteResource => ({
  createdAt: 1000,
  id: 'resource-1',
  resourceId: 'target-1',
  resourceType: 'task',
  role: 'context',
  ...patch,
});

describe('sortResources', () => {
  it('orders task before topic/conversation before page/document before other, newest first within a bucket', () => {
    const other = createResource({ createdAt: 1, id: 'other', resourceType: 'message' });
    const pageOld = createResource({ createdAt: 100, id: 'page-old', resourceType: 'page' });
    const pageNew = createResource({ createdAt: 200, id: 'page-new', resourceType: 'document' });
    const topicOld = createResource({ createdAt: 300, id: 'topic-old', resourceType: 'topic' });
    const topicNew = createResource({
      createdAt: 400,
      id: 'topic-new',
      resourceType: 'conversation',
    });
    const task = createResource({ createdAt: 50, id: 'task', resourceType: 'task' });

    expect(sortResources([other, pageOld, pageNew, topicOld, topicNew, task])).toEqual([
      task,
      topicNew,
      topicOld,
      pageNew,
      pageOld,
      other,
    ]);
  });

  it('returns an empty array when there are no resources', () => {
    expect(sortResources([])).toEqual([]);
  });
});
