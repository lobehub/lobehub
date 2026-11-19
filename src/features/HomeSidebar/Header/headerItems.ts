import { type NavItem } from '@/hooks/useNavLayout';

const ROW_KEYS = new Set(['home']);

export const resolveHeaderItems = (items: NavItem[]) => {
  const visible = items.filter((item) => !item.hidden);

  return {
    rows: visible.filter((item) => ROW_KEYS.has(item.key)),
    search: visible.find((item) => item.key === 'search'),
  };
};
