'use client';

import { ActionIcon, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Flag, MessageSquareText, Repeat, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { VideoLoop } from './RangeLane';
import { formatVideoTime } from './videoTime';

const local = stylex.create({
  kbd: {
    display: 'inline-block',
    minWidth: '16px',
    marginInline: '1px',
    paddingInline: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '10px',
    lineHeight: '16px',
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
  mono: { fontFamily: cssVar.fontFamilyCode, fontVariantNumeric: 'tabular-nums' },
  tools: {
    flex: 'none',
    minHeight: '40px',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadiusLG,
    fontSize: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

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
    <Flexbox horizontal align={'center'} className={stylex.props(local.tools).className} gap={8}>
      {range ? (
        <>
          <Icon icon={Repeat} size={14} />
          <span {...stylex.props(local.mono)}>
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
            <span {...stylex.props(local.kbd)}>Space</span> {t('acceptance.video.play')} ·{' '}
            <span {...stylex.props(local.kbd)}>,</span>
            <span {...stylex.props(local.kbd)}>.</span> {t('acceptance.video.keysFrame')} ·{' '}
            <span {...stylex.props(local.kbd)}>J</span>
            <span {...stylex.props(local.kbd)}>L</span> {t('acceptance.video.speed')} ·{' '}
            <span {...stylex.props(local.kbd)}>M</span> {t('acceptance.video.markFrame')} ·{' '}
            <span {...stylex.props(local.kbd)}>I</span>
            <span {...stylex.props(local.kbd)}>O</span> {t('acceptance.video.keysRange')}
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
