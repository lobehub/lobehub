// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { taskRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('taskRouter procedures', () => {
  const procedures = (taskRouter as any)._def.procedures as Record<string, any>;

  it('exposes exactly the expected procedure paths', () => {
    expect(Object.keys(procedures).sort()).toEqual(expected().map(([name]) => name));
  });

  it.each(expected())('%s is a %s with %i middlewares', (name, type, middlewares) => {
    expect(procedures[name]._def.type).toBe(type);
    expect(procedures[name]._def.middlewares).toHaveLength(middlewares);
  });
});

function expected(): Array<
  [name: string, type: 'mutation' | 'query' | 'subscription', middlewares: number]
> {
  return [
    ['acquireTaskLock', 'mutation', 13],
    ['addComment', 'mutation', 13],
    ['addDependency', 'mutation', 13],
    ['analyzeIntent', 'mutation', 13],
    ['archive', 'mutation', 13],
    ['cancelTopic', 'mutation', 13],
    ['clearAll', 'mutation', 12],
    ['copyTaskToWorkspace', 'mutation', 13],
    ['create', 'mutation', 13],
    ['delete', 'mutation', 13],
    ['deleteComment', 'mutation', 13],
    ['deleteTopic', 'mutation', 13],
    ['detail', 'query', 12],
    ['find', 'query', 12],
    ['getCheckpoint', 'query', 12],
    ['getDependencies', 'query', 12],
    ['getPinnedDocuments', 'query', 12],
    ['getReview', 'query', 12],
    ['getSubtasks', 'query', 12],
    ['getTaskLock', 'query', 13],
    ['getTaskTree', 'query', 12],
    ['getTopics', 'query', 12],
    ['getVerifyConfig', 'query', 12],
    ['groupList', 'query', 12],
    ['heartbeat', 'mutation', 13],
    ['list', 'query', 12],
    ['pinDocument', 'mutation', 13],
    ['previewSubtaskLayers', 'query', 12],
    ['releaseTaskLock', 'mutation', 13],
    ['removeDependency', 'mutation', 13],
    ['reorderSubtasks', 'mutation', 13],
    ['run', 'mutation', 13],
    ['runReadySubtasks', 'mutation', 13],
    ['runReview', 'mutation', 13],
    ['synthesizeInstruction', 'mutation', 13],
    ['transferTask', 'mutation', 13],
    ['unpinDocument', 'mutation', 13],
    ['update', 'mutation', 13],
    ['updateCheckpoint', 'mutation', 13],
    ['updateComment', 'mutation', 13],
    ['updateConfig', 'mutation', 13],
    ['updateReview', 'mutation', 13],
    ['updateStatus', 'mutation', 13],
    ['updateStatusCascade', 'mutation', 13],
    ['updateVerifyConfig', 'mutation', 13],
    ['updateVisibility', 'mutation', 13],
    ['usage', 'query', 12],
    ['watchdog', 'mutation', 12],
  ];
}
