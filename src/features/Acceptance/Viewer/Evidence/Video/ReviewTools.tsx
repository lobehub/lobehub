'use client';

import { ActionIcon, Button, createStaticStyles, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { Flag, MessageSquareText, Repeat, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { VideoLoop } from './RangeLane';
import { formatVideoTime } from './videoTime';

const local = createStaticStyles(({ css }) => ({
  kbd: css`
    display: inline-block;

    min-width: 16px;
    margin-inline: 1px;
    padding-inline: 4px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    line-height: 16px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
  `,
  tools: css`
    flex: none;

    min-height: 40px;
    padding-block: 6px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};

    font-size: 12px;

    background: ${cssVar.colorFillQuaternary};
  `,
}));

interface ReviewToolsProps {
  loop: boolean;
  onClearRange: () => void;
  onCommentRange: () => void;
  onMarkFrame: () => void;
  onToggleLoop: () => void;
  range: VideoLoop | null;
  ready: boolean;
}

/** The selected span and what to do with it, or the keys and the mark button. */
export const ReviewTools = ({
  loop,
  onClearRange,
  onCommentRange,
  onMarkFrame,
  onToggleLoop,
  range,
  ready,
}: ReviewToolsProps) => {
  const { t } = useTranslation('verify');

  return (
    <Flexbox horizontal align={'center'} className={local.tools} gap={8}>
      {range ? (
        <>
          <Icon icon={Repeat} size={14} />
          <span className={local.mono}>
            {formatVideoTime(range.start)} – {formatVideoTime(range.end)}
          </span>
          <Text fontSize={12} type={'secondary'}>
            {t('acceptance.video.rangeSeconds', { seconds: (range.end - range.start).toFixed(1) })}
          </Text>
          <div style={{ flex: 1 }} />
          <Button size={'small'} type={loop ? 'primary' : 'default'} onClick={onToggleLoop}>
            {t('acceptance.video.loop')}
          </Button>
          <Button icon={MessageSquareText} size={'small'} onClick={onCommentRange}>
            {t('acceptance.video.commentRange')}
          </Button>
          <ActionIcon
            icon={X}
            size={'small'}
            title={t('acceptance.video.clearRange')}
            onClick={onClearRange}
          />
        </>
      ) : (
        <>
          <Text fontSize={12} type={'secondary'}>
            <span className={local.kbd}>Space</span> {t('acceptance.video.play')} ·{' '}
            <span className={local.kbd}>,</span>
            <span className={local.kbd}>.</span> {t('acceptance.video.keysFrame')} ·{' '}
            <span className={local.kbd}>J</span>
            <span className={local.kbd}>L</span> {t('acceptance.video.speed')} ·{' '}
            <span className={local.kbd}>M</span> {t('acceptance.video.markFrame')} ·{' '}
            <span className={local.kbd}>I</span>
            <span className={local.kbd}>O</span> {t('acceptance.video.keysRange')}
          </Text>
          <div style={{ flex: 1 }} />
          <Button disabled={!ready} icon={Flag} size={'small'} onClick={onMarkFrame}>
            {t('acceptance.video.markFrame')}
          </Button>
        </>
      )}
    </Flexbox>
  );
};
