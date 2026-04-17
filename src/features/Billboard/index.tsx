'use client';

import { memo, useCallback, useState } from 'react';

import { useGlobalStore } from '@/store/global';
import { useServerConfigStore } from '@/store/serverConfig';

import BillboardCarousel from './Carousel';

export const billboardDismissKey = (slug: string) => `billboard:${slug}`;
export const BILLBOARD_ANCHOR_ATTR = 'data-billboard-anchor';
const CARD_ATTR = 'data-billboard-card';

const Billboard = memo(() => {
  const billboard = useServerConfigStore((s) => s.billboard);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const dismissedSlugs = useGlobalStore((s) => s.status.readNotificationSlugs ?? []);
  const [closing, setClosing] = useState(false);
  const [exitTarget, setExitTarget] = useState<{ x: number; y: number }>({ x: 0, y: 40 });

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

  const handleCloseStart = useCallback(() => {
    const anchor = document.querySelector<HTMLElement>(`[${BILLBOARD_ANCHOR_ATTR}]`);
    const card = document.querySelector<HTMLElement>(`[${CARD_ATTR}]`);
    if (anchor && card) {
      const anchorRect = anchor.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      setExitTarget({
        x: anchorRect.left + anchorRect.width / 2 - (cardRect.left + cardRect.width / 2),
        y: anchorRect.top + anchorRect.height / 2 - (cardRect.top + cardRect.height / 2),
      });
    }
    setClosing(true);
  }, []);

  const handleAnimationFinish = useCallback(() => {
    if (!billboard) return;
    const slug = billboardDismissKey(billboard.slug);
    const current = useGlobalStore.getState().status.readNotificationSlugs ?? [];
    if (!current.includes(slug)) {
      updateSystemStatus({ readNotificationSlugs: [...current, slug] });
    }
    setClosing(false);
  }, [billboard, updateSystemStatus]);

  if (!billboard || !inWindow || isDismissed || billboard.items.length === 0) return null;

  return (
    <BillboardCarousel
      cardAttr={CARD_ATTR}
      closing={closing}
      exitTarget={exitTarget}
      set={billboard}
      onAnimationFinish={handleAnimationFinish}
      onClose={handleCloseStart}
    />
  );
});

Billboard.displayName = 'Billboard';

export default Billboard;
