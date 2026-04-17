'use client';

import { ActionIcon, Button, Flexbox, Tooltip } from '@lobehub/ui';
import { Carousel as AntCarousel } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { type ComponentRef, memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GlobalBillboard, GlobalBillboardItem } from '@/types/serverConfig';

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

const styles = createStaticStyles(({ css }) => ({
  action: css`
    display: block;
    width: 100%;
    margin-block-start: 8px;
  `,
  card: css`
    position: fixed;
    z-index: 1000;
    inset-block-end: 56px;
    inset-inline-start: 8px;
    transform-origin: bottom left;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 300px;
    max-width: calc(100vw - 32px);
    padding: 0;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};
    box-shadow: 0 4px 24px rgb(0 0 0 / 12%);
  `,
  closeButton: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 8px;
    inset-inline-end: 8px;
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;

    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
  `,
  dot: css`
    cursor: pointer;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorFillSecondary};

    transition: all 0.2s;
  `,
  dotActive: css`
    width: 18px;
    border-radius: 3px;
    background: ${cssVar.colorPrimary};
  `,
  dots: css`
    padding-block-end: 10px;
  `,
  image: css`
    display: block;

    width: 100%;
    height: 140px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    object-fit: cover;
  `,
  itemBody: css`
    padding: 12px;
  `,
  title: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
  `,
}));

const ItemContent = memo<{ item: BillboardItem }>(({ item }) => {
  const { t, i18n } = useTranslation('notification');
  const resolved = useMemo(() => resolveBillboardItem(item, i18n.language), [item, i18n.language]);

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
    <div className={styles.title} ref={titleRef}>
      {resolved.title}
    </div>
  );

  const descNode = resolved.description && (
    <div className={styles.description} ref={descRef}>
      {resolved.description}
    </div>
  );

  return (
    <Flexbox gap={0}>
      {item.cover && <img alt="" className={styles.image} src={item.cover} />}
      <Flexbox className={styles.itemBody} gap={4}>
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
        {item.linkUrl && (
          <a
            className={styles.action}
            href={item.linkUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <Button block size="small" type="primary">
              {resolved.linkLabel ?? t('billboard.learnMore')}
            </Button>
          </a>
        )}
      </Flexbox>
    </Flexbox>
  );
});

ItemContent.displayName = 'BillboardItemContent';

const BillboardCarousel = memo<BillboardCarouselProps>(
  ({ set, onClose, closing, exitTarget, onAnimationFinish, cardAttr }) => {
    const [paused, setPaused] = useState(false);
    const [current, setCurrent] = useState(0);
    const carouselRef = useRef<ComponentRef<typeof AntCarousel>>(null);

    if (set.items.length === 0) return null;

    const single = set.items.length === 1;

    const cardDataProps = cardAttr ? { [cardAttr]: '' } : {};

    return (
      <motion.div
        {...cardDataProps}
        className={styles.card}
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
        <ActionIcon className={styles.closeButton} icon={X} size={14} onClick={onClose} />
        {single ? (
          <ItemContent item={set.items[0]} />
        ) : (
          <>
            <AntCarousel
              adaptiveHeight
              autoplay={!paused}
              autoplaySpeed={6000}
              beforeChange={(_: number, next: number) => setCurrent(next)}
              dots={false}
              ref={carouselRef}
            >
              {set.items.map((item) => (
                <div key={item.id}>
                  <ItemContent item={item} />
                </div>
              ))}
            </AntCarousel>
            <Flexbox horizontal className={styles.dots} gap={6} justify="center">
              {set.items.map((item, idx) => (
                <div
                  className={`${styles.dot} ${current === idx ? styles.dotActive : ''}`}
                  key={item.id}
                  onClick={() => carouselRef.current?.goTo(idx)}
                />
              ))}
            </Flexbox>
          </>
        )}
      </motion.div>
    );
  },
);

BillboardCarousel.displayName = 'BillboardCarousel';

export default BillboardCarousel;
