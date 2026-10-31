import { LiteTable } from 'verification:component';

const rows = [
  { id: 'one', name: 'A deterministic first row', status: 'Ready' },
  { id: 'two', name: 'A second row with a longer title', status: 'Pending' },
];

export const Fixture = ({ variant }: { variant: string }) => (
  <LiteTable
    dataSource={variant === 'empty' || variant === 'loading' ? [] : rows}
    emptyText={<span>No rows</span>}
    listBreakpoint={variant === 'wide' ? 800 : 600}
    loading={variant === 'loading'}
    rowKey={(row: (typeof rows)[number]) => row.id}
    tableLayout={variant === 'fixed' ? 'fixed' : 'auto'}
    columns={[
      {
        key: 'name',
        listSlot: 'title',
        render: (row: (typeof rows)[number]) => row.name,
        title: 'Name',
      },
      { key: 'status', render: (row: (typeof rows)[number]) => row.status, title: 'Status' },
      {
        key: 'actions',
        listSlot: 'actions',
        render: () => <button type="button">Open</button>,
        title: 'Actions',
      },
    ]}
    onRowClick={() => {}}
  />
);
