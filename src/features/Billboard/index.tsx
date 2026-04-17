'use client';

import { memo, useCallback } from 'react';

import { useBillboard } from '@/hooks/useBillboards';
import { useGlobalStore } from '@/store/global';

import BillboardCarousel from './Carousel';

export const billboardDismissKey = (slug: string) => `billboard:${slug}`;

const Billboard = memo(() => {
  const { data: billboard } = useBillboard();
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const dismissedSlugs = useGlobalStore((s) => s.status.readNotificationSlugs ?? []);

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

  if (!billboard || isDismissed || billboard.items.length === 0) return null;

  return <BillboardCarousel set={billboard} onClose={handleClose} />;
});

Billboard.displayName = 'Billboard';

export default Billboard;
