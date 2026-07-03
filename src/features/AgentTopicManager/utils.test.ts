import type { ChatTopic } from '@/types/topic';

import { getProjectFilterLabel, getProjectLabel, matchesGroup } from './utils';

const createTopic = (metadata: ChatTopic['metadata']): ChatTopic => ({
  createdAt: 1,
  id: 'topic-1',
  metadata,
  title: 'Topic',
  updatedAt: 1,
});

describe('AgentTopicManager utils', () => {
  it('matches project filters by source path while displaying active worktree context', () => {
    const topic = createTopic({
      workingDirectory: '/repo-fix',
      workingDirectoryConfig: {
        git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
        path: '/repo',
        repoType: 'git',
      },
    });

    expect(matchesGroup(topic, ['/repo'])).toBe(true);
    expect(matchesGroup(topic, ['/repo-fix'])).toBe(false);
    expect(getProjectFilterLabel(topic)).toBe('repo');
    expect(getProjectLabel(topic)).toBe('repo/repo-fix · fix');
  });
});
