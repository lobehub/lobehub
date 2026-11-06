import { ReplicaEntryTable } from 'verification:component';

const row = (key: string, pending: number) => ({
  data: { items: [1, 2, 3] },
  hasBase: true,
  key,
  params: {},
  pending,
  query: 'topics.list',
  source: 'server',
  updatedAt: new Date('2026-01-02T03:04:05.000Z'),
});

const noop = () => {};

export const Fixture = ({ variant }: { variant: string }) => (
  <div style={{ display: 'flex', height: 360 }}>
    <ReplicaEntryTable
      matchingCount={variant === 'empty' ? 0 : 3}
      rows={variant === 'empty' ? [] : [row('alpha', 0), row('beta', 2), row('gamma', 0)]}
      search=""
      selectedKey={variant === 'selected' ? 'alpha' : undefined}
      title="topics"
      totalCount={3}
      onRevalidate={noop}
      onSearchChange={noop}
      onSelect={noop}
    />
  </div>
);
