import { InlineTable } from 'verification:component';

const rows = [
  { id: 'one', name: 'First row', status: 'Ready' },
  { id: 'two', name: 'Second row', status: 'Pending' },
];
const columns = [
  { dataIndex: 'name', key: 'name', title: 'Name' },
  { dataIndex: 'status', key: 'status', title: 'Status' },
];

export const Fixture = ({ variant }: { variant: string }) => (
  <InlineTable
    columns={columns}
    dataSource={variant === 'empty' ? [] : rows}
    hoverToActive={variant === 'hoverable'}
    rowKey="id"
  />
);
