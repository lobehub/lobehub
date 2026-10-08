import { FilesTabs } from '@/types/files';

interface ResourceCategoryItem {
  isBusiness?: boolean;
  key: string;
  url: string;
}

export const isResourceCategoryActive = (
  item: ResourceCategoryItem,
  activeKey: string,
  pathname: string,
): boolean => {
  const worksActive = pathname.endsWith('/resource/works');

  if (item.key === 'works') return worksActive;
  if (item.key === FilesTabs.Home) {
    return activeKey === FilesTabs.Home && /\/resource\/?$/.test(pathname);
  }

  return !worksActive && (item.isBusiness ? pathname === item.url : activeKey === item.key);
};
