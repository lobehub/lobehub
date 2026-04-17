'use client';

import { memo, useCallback } from 'react';

import { useGlobalStore } from '@/store/global';
import { useServerConfigStore } from '@/store/serverConfig';

import BillboardCarousel from './Carousel';

export const billboardDismissKey = (slug: string) => `billboard:${slug}`;

const Billboard = memo(() => {
  const billboard = useServerConfigStore((s) => s.billboard);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const dismissedSlugs = useGlobalStore((s) => s.status.readNotificationSlugs ?? []);

  // 时间窗口检查：startAt <= now <= endAt
  const inWindow = billboard
    ? (() => {
        const now = Date.now();
        const start = Date.parse(billboard.startAt);
        const end = Date.parse(billboard.endAt);
        return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
      })()
    : false;

  const isDismissed = billboard
    ? dismissedSlugs.includes(billboardDismissKey(billboard.slug))
    : true;

  const handleClose = useCallback(() => {
    if (!billboard) return;
    const slug = billboardDismissKey(billboard.slug);
    const current = useGlobalStore.getState().status.readNotificationSlugs ?? [];
    if (!current.includes(slug)) {
      updateSystemStatus({ readNotificationSlugs: [...current, slug] });
    }
  }, [billboard, updateSystemStatus]);

  if (!billboard || !inWindow || isDismissed || billboard.items.length === 0) return null;

  return <BillboardCarousel set={billboard} onClose={handleClose} />;
});

Billboard.displayName = 'Billboard';

export default Billboard;
