'use client';

import { ActionIcon, Button, Carousel, Flexbox, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { X } from 'lucide-react';
import * as m from 'motion/react-m';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAnalytics } from '@/libs/analytics/client';
import type { GlobalBillboard, GlobalBillboardItem } from '@/types/serverConfig';

import { resolveBillboardAction, runBillboardAction } from './actions';
import { resolveBillboardItem } from './locale';

type BillboardItem = GlobalBillboardItem;

interface BillboardCarouselProps {
  cardAttr?: string;
  closing?: boolean;
  exitTarget?: { x: number; y: number };
  onAnimationFinish?: () => void;
  onClose: () => void;
  set: GlobalBillboard;
}

const styles = stylex.create({
  action: { display: 'block', width: '100%', marginBlockStart: '8px' },
  card: {
    position: 'fixed',
    zIndex: 1000,
    insetBlockEnd: '56px',
    insetInlineStart: '8px',
    transformOrigin: 'bottom left',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    width: '300px',
    maxWidth: 'calc(100vw - 32px)',
    padding: '0',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '12px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    boxShadow: '0 4px 24px rgb(0 0 0 / 12%)',
  },
  closeButton: {
    position: 'absolute',
    zIndex: 10,
    insetBlockStart: '8px',
    insetInlineEnd: '8px',
    color: { 'default': '#fff', ':hover': '#fff' },
    backgroundColor: { 'default': 'rgb(0 0 0 / 45%)', ':hover': 'rgb(0 0 0 / 60%)' },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    backdropFilter: 'blur(4px)',
  },
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '4',
    fontSize: '14px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
  },
  dot: {
    cursor: 'pointer',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
    transition: 'all 0.2s',
  },
  dotActive: {
    width: '18px',
    borderRadius: '3px',
    backgroundColor: cssVar.colorPrimary,
    backgroundImage: 'none',
  },
  dots: { paddingBlockEnd: '10px' },
  image: {
    display: 'block',
    width: '100%',
    height: '140px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    objectFit: 'cover',
  },
  itemBody: { padding: '12px' },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '2',
    fontSize: '16px',
    fontWeight: 600,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
  },
});

const ItemContent = memo<{
  billboardSlug: string;
  item: BillboardItem;
  onClose: () => void;
  position: number;
}>(({ item, billboardSlug, position, onClose }) => {
  const { t, i18n } = useTranslation('notification');
  const { analytics } = useAnalytics();
  const resolved = useMemo(() => resolveBillboardItem(item, i18n.language), [item, i18n.language]);

  const action = resolveBillboardAction(item.action);

  const trackCtaClick = useCallback(
    (extra: Record<string, unknown>) => {
      analytics?.track({
        name: 'billboard_cta_clicked',
        properties: {
          billboard_slug: billboardSlug,
          item_id: item.id,
          position,
          spm: 'billboard.cta.clicked',
          ...extra,
        },
      });
    },
    [analytics, billboardSlug, item.id, position],
  );

  const handleActionClick = useCallback(async () => {
    if (!action) return;
    trackCtaClick({ action });
    onClose();
    await Promise.resolve(runBillboardAction(action)).catch(() => {});
  }, [action, trackCtaClick, onClose]);

  const handleLinkClick = useCallback(() => {
    trackCtaClick({ link_url: item.linkUrl });
    onClose();
  }, [trackCtaClick, item.linkUrl, onClose]);

  const titleRef = useRef<HTMLDivElement>(null);
  const descRef = useRef<HTMLDivElement>(null);
  const [titleOverflow, setTitleOverflow] = useState(false);
  const [descOverflow, setDescOverflow] = useState(false);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    setTitleOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [resolved.title]);

  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el) return;
    setDescOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [resolved.description]);

  const titleNode = (
    <div {...stylex.props(styles.title)} ref={titleRef}>
      {resolved.title}
    </div>
  );

  const descNode = resolved.description && (
    <div {...stylex.props(styles.description)} ref={descRef}>
      {resolved.description}
    </div>
  );

  return (
    <Flexbox gap={0}>
      {item.cover && <img alt="" {...stylex.props(styles.image)} src={item.cover} />}
      <Flexbox className={stylex.props(styles.itemBody).className} gap={4}>
        {titleOverflow ? (
          <Tooltip placement="top" title={resolved.title}>
            {titleNode}
          </Tooltip>
        ) : (
          titleNode
        )}
        {descNode &&
          (descOverflow ? (
            <Tooltip placement="top" title={resolved.description}>
              {descNode}
            </Tooltip>
          ) : (
            descNode
          ))}
        {action ? (
          <Button
            block
            className={stylex.props(styles.action).className}
            type="primary"
            onClick={handleActionClick}
          >
            {resolved.linkLabel ?? t('billboard.learnMore')}
          </Button>
        ) : (
          item.linkUrl && (
            <a
              {...stylex.props(styles.action)}
              href={item.linkUrl}
              rel="noopener noreferrer"
              target="_blank"
              onClick={handleLinkClick}
            >
              <Button block type="primary">
                {resolved.linkLabel ?? t('billboard.learnMore')}
              </Button>
            </a>
          )
        )}
      </Flexbox>
    </Flexbox>
  );
});

ItemContent.displayName = 'BillboardItemContent';

const BILLBOARD_IMPRESSION_STORAGE_PREFIX = 'billboard:impression:';

const BillboardCarousel = memo<BillboardCarouselProps>(
  ({ set, onClose, closing, exitTarget, onAnimationFinish, cardAttr }) => {
    const [paused, setPaused] = useState(false);
    const [current, setCurrent] = useState(0);
    const { analytics } = useAnalytics();

    useEffect(() => {
      if (!analytics || set.items.length === 0) return;
      const key = `${BILLBOARD_IMPRESSION_STORAGE_PREFIX}${set.slug}`;
      try {
        if (globalThis.sessionStorage?.getItem(key) === '1') return;
        globalThis.sessionStorage?.setItem(key, '1');
      } catch {
        // ignore storage access errors (e.g. private mode) and still report
      }
      void analytics.track({
        name: 'billboard_served',
        properties: {
          billboard_slug: set.slug,
          item_count: set.items.length,
          spm: 'billboard.card.served',
        },
      });
    }, [analytics, set.slug, set.items.length]);

    if (set.items.length === 0) return null;

    const single = set.items.length === 1;

    const cardDataProps = cardAttr ? { [cardAttr]: '' } : {};

    return (
      <m.div
        {...cardDataProps}
        {...stylex.props(styles.card)}
        initial={{ opacity: 0, scale: 0.92, y: 16 }}
        transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        animate={
          closing
            ? { opacity: 0, scale: 0.15, x: exitTarget?.x ?? 0, y: exitTarget?.y ?? 40 }
            : { opacity: 1, scale: 1, x: 0, y: 0 }
        }
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onAnimationComplete={() => {
          if (closing) onAnimationFinish?.();
        }}
      >
        <ActionIcon
          className={stylex.props(styles.closeButton).className}
          icon={X}
          size={14}
          onClick={onClose}
        />
        {single ? (
          <ItemContent
            billboardSlug={set.slug}
            item={set.items[0]}
            position={0}
            onClose={onClose}
          />
        ) : (
          <>
            <Carousel
              adaptiveHeight
              autoplay={paused ? false : 6000}
              dots={false}
              index={current}
              onIndexChange={setCurrent}
            >
              {set.items.map((item, idx) => (
                <div key={item.id}>
                  <ItemContent
                    billboardSlug={set.slug}
                    item={item}
                    position={idx}
                    onClose={onClose}
                  />
                </div>
              ))}
            </Carousel>
            <Flexbox
              horizontal
              className={stylex.props(styles.dots).className}
              gap={6}
              justify="center"
            >
              {set.items.map((item, idx) => (
                <div
                  {...stylex.props(styles.dot, current === idx && styles.dotActive)}
                  key={item.id}
                  onClick={() => setCurrent(idx)}
                />
              ))}
            </Flexbox>
          </>
        )}
      </m.div>
    );
  },
);

BillboardCarousel.displayName = 'BillboardCarousel';

export default BillboardCarousel;
