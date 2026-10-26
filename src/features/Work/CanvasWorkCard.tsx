'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { cx, Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  bar: {
    backgroundColor: cssVar.colorFillSecondary,
    borderRadius: 2,
    height: 5,
  },
  barLong: {
    width: '90%',
  },
  barMedium: {
    width: '80%',
  },
  barTitle: {
    height: 7,
    width: '70%',
  },
  box: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 3,
    borderStyle: 'solid',
    borderWidth: 1,
    flex: '1',
    height: 16,
  },
  card: {
    backgroundColor: cssVar.colorBgElevated,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
  chart: {
    backgroundImage: `linear-gradient(180deg, transparent 45%, ${cssVar.colorFillTertiary} 45%)`,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 3,
    borderStyle: 'solid',
    borderWidth: 1,
    height: 26,
  },
  clickable: {
    borderColor: { ':hover': cssVar.colorBorder, 'default': cssVar.colorBorderSecondary },
    cursor: 'pointer',
  },
  info: {
    minWidth: 0,
    paddingBlock: 12,
    paddingInline: 14,
  },
  meta: {
    marginBlockStart: 'auto',
  },
  thumb: {
    backgroundColor: cssVar.colorBgContainerSecondary,
    borderInlineEndColor: cssVar.colorBorderSecondary,
    borderInlineEndStyle: 'solid',
    borderInlineEndWidth: 1,
    flex: 'none',
    padding: 10,
    width: 120,
  },
});

interface CanvasWorkCardProps {
  className?: string;
  item: WorkSummaryItem;
  onOpen?: () => void;
}

const CanvasWorkCard = memo<CanvasWorkCardProps>(({ className, item, onOpen }) => {
  const { t } = useTranslation('chat');
  const version = item.event.version;
  const updatedAt = new Date(item.event.createdAt ?? item.updatedAt).toLocaleString();
  const cardProps = stylex.props(styles.card, onOpen && styles.clickable);

  return (
    <Flexbox
      horizontal
      {...cardProps}
      className={cx(cardProps.className, className)}
      onClick={onOpen}
    >
      <Flexbox gap={5} {...stylex.props(styles.thumb)}>
        <div {...stylex.props(styles.bar, styles.barTitle)} />
        <div {...stylex.props(styles.bar, styles.barLong)} />
        <Flexbox horizontal gap={4}>
          <div {...stylex.props(styles.box)} />
          <div {...stylex.props(styles.box)} />
          <div {...stylex.props(styles.box)} />
        </Flexbox>
        <div {...stylex.props(styles.chart)} />
        <div {...stylex.props(styles.bar, styles.barMedium)} />
      </Flexbox>
      <Flexbox flex={1} gap={4} {...stylex.props(styles.info)}>
        <Text ellipsis strong>
          {item.title || t('workingPanel.works.canvasUntitled')}
        </Text>
        {item.description && (
          <Text ellipsis={{ rows: 2 }} fontSize={12} type={'secondary'}>
            {item.description}
          </Text>
        )}
        <Flexbox horizontal align={'center'} gap={6} {...stylex.props(styles.meta)}>
          <Tag size={'small'}>{`v${version}`}</Tag>
          <Text fontSize={12} type={'secondary'}>
            {updatedAt}
          </Text>
          {item.url && (
            <Tag color={'blue'} size={'small'}>
              {t('workingPanel.works.canvasShared')}
            </Tag>
          )}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

CanvasWorkCard.displayName = 'CanvasWorkCard';

export default CanvasWorkCard;
