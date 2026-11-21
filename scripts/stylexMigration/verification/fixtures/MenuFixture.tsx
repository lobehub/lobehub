import { Menu } from 'verification:component';

const items = [
  { key: 'first', label: 'First item' },
  { key: 'divider', type: 'divider' as const },
  { disabled: true, key: 'disabled', label: 'Disabled item' },
  { key: 'last', label: 'A longer menu label with trailing content', extra: 'Extra' },
];

export const Fixture = ({ variant }: { variant: string }) => (
  <Menu
    activeKey={variant === 'selectable' ? 'first' : undefined}
    compact={variant === 'compact'}
    items={items}
    selectable={variant === 'selectable'}
    styles={
      variant === 'custom' ? { item: { marginInline: 12, color: 'rgb(80, 90, 100)' } } : undefined
    }
  />
);
