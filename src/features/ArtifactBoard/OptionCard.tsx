'use client';

import type { ArtifactBoardOption } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useInViewport } from 'ahooks';
import { CheckCircle2, Maximize2, Sparkles } from 'lucide-react';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { openCanvasModal } from '@/features/CanvasModal/loader';
import CanvasFrame from '@/features/Conversation/WorkingSidebar/Canvas/CanvasFrame';

/** The page renders at a desktop viewport, then shrinks to the card. */
const PAGE_WIDTH = 1280;
const PAGE_HEIGHT = 800;
const THUMB_SCALE = 0.25;
export const OPTION_CARD_WIDTH = PAGE_WIDTH * THUMB_SCALE;

const styles = stylex.create({
  card: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 10,
    borderStyle: 'solid',
    borderWidth: 1,
    cursor: 'pointer',
    flexShrink: 0,
    overflow: 'hidden',
    textAlign: 'start',
    transitionDuration: '150ms',
    transitionProperty: 'border-color, box-shadow',
    width: OPTION_CARD_WIDTH + 2,
  },
  chosen: {
    borderColor: cssVar.colorPrimary,
    boxShadow: `0 0 0 2px ${cssVar.colorPrimaryBg}`,
  },
  thumb: {
    backgroundColor: cssVar.colorFillQuaternary,
    height: PAGE_HEIGHT * THUMB_SCALE,
    overflow: 'hidden',
    position: 'relative',
    width: OPTION_CARD_WIDTH,
  },
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: PAGE_HEIGHT,
    // The thumbnail is a picture to pick from; clicking it chooses, it does not drive the page.
    pointerEvents: 'none',
    transform: `scale(${THUMB_SCALE})`,
    transformOrigin: 'top left',
    width: PAGE_WIDTH,
  },
  expand: {
    insetBlockStart: 6,
    insetInlineEnd: 6,
    position: 'absolute',
  },
  body: {
    paddingBlock: 10,
    paddingInline: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: 600,
  },
  ref: {
    color: cssVar.colorTextTertiary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 11,
  },
});

interface OptionCardProps {
  chosen: boolean;
  disabled?: boolean;
  onChoose: () => void;
  option: ArtifactBoardOption;
}

/**
 * One option: its Canvas page as a live thumbnail, mounted only while the card
 * is near the viewport — a board can hold dozens of options, and every mounted
 * one is a full Canvas runtime.
 */
const OptionCard = memo<OptionCardProps>(({ chosen, disabled, onChoose, option }) => {
  const { t } = useTranslation('portal');
  const ref = useRef<HTMLDivElement>(null);
  const [inViewport] = useInViewport(ref, { rootMargin: '300px' });

  return (
    <div
      {...stylex.props(styles.card, chosen && styles.chosen)}
      aria-pressed={chosen}
      data-testid={`board-option-${option.id}`}
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={() => !disabled && onChoose()}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onChoose();
        }
      }}
    >
      <div {...stylex.props(styles.thumb)}>
        {inViewport && (
          <div {...stylex.props(styles.page)}>
            <CanvasFrame
              canvasId={option.canvasId}
              page={option.page}
              version={option.canvasVersion}
            />
          </div>
        )}
        <div {...stylex.props(styles.expand)}>
          <ActionIcon
            icon={Maximize2}
            size="small"
            title={t('board.option.open')}
            variant="filled"
            onClick={(event) => {
              event.stopPropagation();
              void openCanvasModal(option.canvasId, option.canvasVersion, option.page);
            }}
          />
        </div>
      </div>
      <Flexbox gap={6} {...stylex.props(styles.body)}>
        <Flexbox horizontal align="center" gap={6}>
          <span {...stylex.props(styles.label)}>{option.label}</span>
          {option.recommended && (
            <Tag color="gold" icon={<Icon icon={Sparkles} />} size="small">
              {t('board.option.recommended')}
            </Tag>
          )}
          {chosen && (
            <Tag color="processing" icon={<Icon icon={CheckCircle2} />} size="small">
              {t('board.option.chosen')}
            </Tag>
          )}
        </Flexbox>
        {option.reason && (
          <Text fontSize={12} type="secondary">
            {option.reason}
          </Text>
        )}
        <span {...stylex.props(styles.ref)}>
          {`${option.canvasId} · v${option.canvasVersion}${option.page ? ` · ${option.page}` : ''}`}
        </span>
      </Flexbox>
    </div>
  );
});

OptionCard.displayName = 'ArtifactBoardOptionCard';

export default OptionCard;
