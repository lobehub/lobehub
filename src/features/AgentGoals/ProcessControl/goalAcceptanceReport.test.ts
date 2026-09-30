import { describe, expect, it } from 'vitest';

import { pickFinalDeliverable } from './goalAcceptanceReport';

describe('pickFinalDeliverable', () => {
  const artifact = (
    resourceId: string,
    minute: number,
    nodeId = 'task_work',
    type = 'document',
  ) => ({
    createdAt: new Date(2026, 8, 16, 1, minute),
    nodeId,
    resourceId,
    title: `Doc ${resourceId}`,
    type,
  });

  /**
   * Regression: the finished Goal showed the acceptance report (and before that
   * the acceptance Task's synthesized finding) in place of the task list, while
   * the owner wanted to read the product the Goal made.
   */
  it('picks the newest document the work produced', () => {
    expect(
      pickFinalDeliverable(
        [
          artifact('docs_old', 1),
          artifact('docs_new', 5),
          artifact('file_1', 9, 'task_work', 'file'),
        ],
        'task_acceptance',
      ),
    ).toEqual({ documentId: 'docs_new', nodeId: 'task_work', title: 'Doc docs_new' });
  });

  it('prefers the work over a document the acceptance task wrote', () => {
    expect(
      pickFinalDeliverable(
        [artifact('docs_work', 1), artifact('docs_check_notes', 9, 'task_acceptance')],
        'task_acceptance',
      ),
    ).toMatchObject({ documentId: 'docs_work' });

    expect(
      pickFinalDeliverable([artifact('docs_check_notes', 9, 'task_acceptance')], 'task_acceptance'),
    ).toMatchObject({ documentId: 'docs_check_notes' });
  });

  it('keeps the binding id so the document opens in-app', () => {
    expect(
      pickFinalDeliverable(
        [{ ...artifact('docs_1', 1), agentDocumentId: 'agd_1' }],
        'task_acceptance',
      ),
    ).toMatchObject({ agentDocumentId: 'agd_1', documentId: 'docs_1' });
  });

  it('returns nothing when the Goal left no document', () => {
    expect(pickFinalDeliverable([], 'task_acceptance')).toBeUndefined();
    expect(
      pickFinalDeliverable([artifact('file_1', 1, 'task_work', 'file')], 'task_acceptance'),
    ).toBeUndefined();
  });
});
