import type { TaskDetailData } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildTaskDetailPrompt } from './buildTaskDetailPrompt';

const NOW = new Date('2026-03-22T12:00:00Z');

const baseTask: TaskDetailData = {
  identifier: 'T-3',
  instruction: '写第3章 评测方法论',
  name: 'Chapter 3',
  priority: 2,
  status: 'running',
};

describe('buildTaskDetailPrompt', () => {
  it('renders minimal task with page_context header', () => {
    const result = buildTaskDetailPrompt({ task: baseTask }, NOW);

    expect(result).toMatchSnapshot();
    expect(result).toContain('<page_context>');
    expect(result).toContain('T-3');
    expect(result).toContain('<task>');
    expect(result).not.toContain('<high_priority_instruction>');
  });

  it('includes subtasks, dependencies, and review', () => {
    const result = buildTaskDetailPrompt(
      {
        task: {
          ...baseTask,
          description: '面向开发者',
          agentId: 'agt_xxx',
          parent: { identifier: 'T-1', name: 'Book' },
          dependencies: [{ dependsOn: 'T-2', type: 'completion' }],
          subtasks: [
            { identifier: 'T-3-1', name: 'Draft', status: 'completed' },
            { identifier: 'T-3-2', name: 'Polish', status: 'backlog', blockedBy: 'T-3-1' },
          ],
          review: {
            enabled: true,
            maxIterations: 3,
            rubrics: [{ name: 'Clarity', type: 'llm', threshold: 0.8 }],
          },
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    expect(result).toContain('Parent: T-1');
    expect(result).toContain('Dependencies: completion: T-2');
    expect(result).toContain('Subtasks:');
    expect(result).toContain('Review (maxIterations: 3)');
  });

  it('renders workspace tree and activities timeline', () => {
    const result = buildTaskDetailPrompt(
      {
        task: {
          ...baseTask,
          workspace: [
            {
              documentId: 'doc_root',
              fileType: 'custom/folder',
              title: 'Drafts',
              children: [
                {
                  documentId: 'doc_ch3',
                  fileType: 'text/markdown',
                  title: 'ch3.md',
                  size: 1200,
                },
              ],
            },
          ],
          activities: [
            {
              type: 'topic',
              id: 'tpc_001',
              seq: 1,
              status: 'completed',
              time: '2026-03-22T09:00:00Z',
              title: 'Outline',
            },
            {
              type: 'brief',
              briefType: 'decision',
              id: 'brief_001',
              priority: 'normal',
              resolvedAction: 'approve',
              time: '2026-03-22T10:00:00Z',
              title: '大纲通过',
            },
            {
              type: 'comment',
              content: '需要加评测章节',
              time: '2026-03-22T11:00:00Z',
            },
            {
              type: 'comment',
              agentId: 'agt_xxx',
              content: '已添加评测章节',
              time: '2026-03-22T11:30:00Z',
            },
          ],
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    expect(result).toContain('Workspace (2)');
    expect(result).toContain('📁');
    expect(result).toContain('📄');
    expect(result).toContain('Activities:');
    expect(result).toContain('💬');
    expect(result).toContain('📋');
    expect(result).toContain('👤 user');
    expect(result).toContain('🤖 agent');
  });
});
