import { MemoryRouter } from 'react-router';
import { AgentCard } from 'verification:component';

const ownerAvatar =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="%23888"/></svg>';

const patternIds = [
  'agent-0',
  'agent-1',
  'agent-2',
  'agent-3',
  'agent-4',
  'agent-5',
  'agent-6',
  'agent-7',
];

const items = [
  ...patternIds.map((id, index) => ({
    avatar: undefined,
    description:
      index % 2
        ? 'Reviews pull requests and leaves concise, actionable comments on every changed file.'
        : 'Short.',
    id,
    name: index % 2 ? `Ada ${index}` : undefined,
    title: `Pattern agent ${index} with a role long enough to need an ellipsis`,
    type: 'agent' as const,
  })),
  {
    avatar: undefined,
    backgroundColor: '#ffcc00',
    description: 'Picked its own cover color.',
    id: 'agent-color',
    labels: [{ color: '#c41d7f', id: 'label-1', name: 'Hackathon' }],
    slug: 'inbox',
    title: 'Colored cover with a very long name that must ellipsize',
    type: 'agent' as const,
  },
  {
    avatar: undefined,
    backgroundColor: ownerAvatar,
    description: 'Uploaded a profile cover image.',
    id: 'agent-image',
    title: 'Image cover',
    type: 'agent' as const,
  },
  {
    avatar: [],
    description: 'A group chat.',
    id: 'group-1',
    title: 'Group',
    type: 'group' as const,
  },
];

const owner = { avatar: ownerAvatar, name: 'A very long owner display name for truncation' };

export const Fixture = () => (
  <MemoryRouter>
    <div
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))',
      }}
    >
      {items.map((item, index) => (
        <AgentCard item={item} key={item.id} owner={index % 3 === 0 ? owner : undefined} />
      ))}
    </div>
  </MemoryRouter>
);
