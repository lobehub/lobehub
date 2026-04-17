'use client';

import { ActionIcon, Button, Flexbox } from '@lobehub/ui';
import { Carousel as AntCarousel } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { X } from 'lucide-react';
import { type ComponentRef, memo, useRef, useState } from 'react';

import type { GlobalBillboard } from '@/types/serverConfig';

type BillboardItem = GlobalBillboard['items'][number];

interface BillboardCarouselProps {
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

    overflow: hidden;

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
    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
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
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

const ItemContent = memo<{ item: BillboardItem }>(({ item }) => (
  <Flexbox gap={0}>
    {item.cover && <img alt="" className={styles.image} src={item.cover} />}
    <Flexbox className={styles.itemBody} gap={4}>
      <div className={styles.title}>{item.title}</div>
      {item.description && <div className={styles.description}>{item.description}</div>}
      {item.linkUrl && (
        <a className={styles.action} href={item.linkUrl} rel="noopener noreferrer" target="_blank">
          <Button block size="small" type="primary">
            {item.linkLabel ?? 'Learn more'}
          </Button>
        </a>
      )}
    </Flexbox>
  </Flexbox>
));

ItemContent.displayName = 'BillboardItemContent';

const BillboardCarousel = memo<BillboardCarouselProps>(({ set, onClose }) => {
  const [paused, setPaused] = useState(false);
  const [current, setCurrent] = useState(0);
  const carouselRef = useRef<ComponentRef<typeof AntCarousel>>(null);

  if (set.items.length === 0) return null;

  const single = set.items.length === 1;

  return (
    <Flexbox
      className={styles.card}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <ActionIcon className={styles.closeButton} icon={X} size={14} onClick={onClose} />
      {single ? (
        <ItemContent item={set.items[0]} />
      ) : (
        <>
          <AntCarousel
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
    </Flexbox>
  );
});

BillboardCarousel.displayName = 'BillboardCarousel';

export default BillboardCarousel;
