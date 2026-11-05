import { MemoryRouter } from 'react-router';
import { TopicCard } from 'verification:component';

const longPath = '/Users/dev/projects/a-workspace-with-a-very-long-folder-name-that-must-truncate';

const topics = [
  {
    createdAt: 0,
    firstUserMessage: 'Refactor the card grid so long folder names truncate inside the border.',
    id: 'topic-1',
    messageCount: 12,
    metadata: {
      workingDirectoryConfig: {
        git: { branch: 'feature/an-extremely-long-branch-name-for-truncation-checks' },
        path: longPath,
      },
    },
    title: 'Card grid truncation',
    updatedAt: 0,
  },
  {
    createdAt: 0,
    id: 'topic-2',
    messageCount: 3,
    metadata: { workingDirectory: '/srv/app' },
    title: 'Short project',
    updatedAt: 0,
  },
];

export const Fixture = () => (
  <MemoryRouter>
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      {topics.map((topic) => (
        <TopicCard agentId="agent-1" key={topic.id} topic={topic} />
      ))}
    </div>
  </MemoryRouter>
);
