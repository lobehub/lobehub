import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import { inputs } from './fixtures';

/**
 * Characterization tests for flatten() paths the hand-written scenario fixtures
 * never reached. Each case targets a specific uncovered branch in
 * FlatListBuilder; assertions pin the observable shape so a traversal rewrite
 * has to reproduce it.
 */
describe('flatList edge cases', () => {
  it('should treat the first message as virtual root when every message has a parent', () => {
    const result = parse(inputs.edgeCases.orphanThreadRoot);

    expect(result.flatList.map((m) => m.id)).toEqual([
      'msg-thread-user-1',
      'msg-thread-assistant-1',
      'msg-thread-user-2',
      'msg-thread-assistant-2',
    ]);
  });

  it('should fold a task-completion signal turn into the assistant group', () => {
    const result = parse(inputs.edgeCases.taskCompletionSignal);

    expect(result.flatList).toHaveLength(2);
    expect(result.flatList[0].role).toBe('user');

    const group = result.flatList[1] as any;
    expect(group.role).toBe('assistantGroup');
    expect(group.children.map((c: any) => c.id)).toEqual(['msg-assistant-1']);
    // the post-task summary rides in its own field, rendered after the group body
    expect(group.taskCompletions.map((c: any) => c.id)).toEqual(['msg-completion-1']);
  });

  it('should emit an assistant group sibling alongside aggregated tasks', () => {
    const result = parse(inputs.edgeCases.tasksWithAssistantGroupSibling);

    const roles = result.flatList.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistantGroup', 'tasks', 'assistantGroup']);
    expect((result.flatList[2] as any).tasks).toHaveLength(2);
    expect((result.flatList[3] as any).children.map((c: any) => c.id)).toEqual([
      'msg-assistant-followup',
    ]);
  });

  it('should surface a supervisor summary parented to a task message', () => {
    const result = parse(inputs.edgeCases.taskChildSupervisorSummary);

    const summary = result.flatList.find((m) => m.id === 'msg-supervisor-summary');
    expect(summary).toBeDefined();
    expect(summary!.role).toBe('supervisor');
    expect(summary!.content).toBe('');
    expect((summary as any).children).toHaveLength(1);
    expect((summary as any).children[0].content).toContain('Both audits are in');
  });

  it('should drop branch metadata when the active assistant branch is not created yet', () => {
    const result = parse(inputs.edgeCases.optimisticAssistantBranch);

    expect(result.flatList.map((m) => m.id)).toEqual(['msg-user-1', 'msg-assistant-1']);
    expect((result.flatList[1] as any).branches).toBeUndefined();
  });
});
