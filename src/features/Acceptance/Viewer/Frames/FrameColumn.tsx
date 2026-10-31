'use client';

import type {
  AcceptanceCommentThread,
  AcceptanceFrame,
  AcceptanceFrameBoardView,
  AcceptanceFrameOperation,
} from '@lobechat/types';
import { getAcceptanceFrameStage } from '@lobechat/types';
import { Button, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, LayoutTemplate, Lock, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  canvasRefLabel,
  FRAME_STAGE_COLOR,
  shownVersionOf,
  threadsForFrameTarget,
} from './frameBoard';
import SourceBadge from './SourceBadge';

export const FRAME_COLUMN_WIDTH = 184;

const styles = stylex.create({
  column: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 10,
    borderStyle: 'solid',
    borderWidth: 1,
    flexShrink: 0,
    padding: 10,
    transitionDuration: '150ms',
    transitionProperty: 'border-color, box-shadow',
    width: FRAME_COLUMN_WIDTH,
  },
  active: {
    borderColor: cssVar.colorPrimaryBorder,
    boxShadow: `0 0 0 2px ${cssVar.colorPrimaryBg}`,
  },
  head: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    cursor: 'pointer',
    padding: 0,
    textAlign: 'start',
    width: '100%',
  },
  index: {
    color: cssVar.colorTextTertiary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 11,
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
  },
  version: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    padding: 6,
  },
  reference: {
    backgroundColor: {
      ':hover': cssVar.colorFillTertiary,
      'default': cssVar.colorFillQuaternary,
    },
    borderRadius: 6,
    borderWidth: 0,
    cursor: 'pointer',
    paddingBlock: 8,
    paddingInline: 8,
    textAlign: 'start',
    width: '100%',
  },
  shown: {
    boxShadow: `inset 0 0 0 1px ${cssVar.colorPrimaryBorder}`,
  },
  chosen: {
    borderColor: cssVar.colorPrimary,
    borderStyle: 'solid',
  },
  baseline: {
    borderColor: cssVar.colorWarning,
    borderStyle: 'solid',
    borderWidth: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: 500,
  },
});

interface FrameColumnProps {
  active: boolean;
  board: AcceptanceFrameBoardView;
  frame: AcceptanceFrame;
  frameThreads: AcceptanceCommentThread[];
  index: number;
  onActivate: () => void;
  /** Show this version's Canvas in the detail below. */
  onPreview: (versionId: string) => void;
  onUpdate: (operation: AcceptanceFrameOperation) => Promise<boolean>;
  previewVersionId?: string;
}

/**
 * One node of the board: its candidate Canvas references stacked under one
 * header. A card names the Canvas page; clicking it opens that page live in
 * the detail below. Choosing a version is the review's conclusion; the locked
 * one wears the baseline frame from then on.
 */
const FrameColumn = ({
  active,
  board,
  frame,
  frameThreads,
  index,
  onActivate,
  onPreview,
  onUpdate,
  previewVersionId,
}: FrameColumnProps) => {
  const { t } = useTranslation('verify');
  const stage = getAcceptanceFrameStage(frame);
  const locked = Boolean(frame.baseline);
  const shown = active ? shownVersionOf(frame, previewVersionId) : undefined;

  return (
    <Flexbox gap={10} {...stylex.props(styles.column, active && styles.active)}>
      <button type={'button'} {...stylex.props(styles.head)} onClick={onActivate}>
        <Flexbox gap={4}>
          <Flexbox horizontal align={'center'} gap={6} justify={'space-between'}>
            <span {...stylex.props(styles.index)}>
              {String(index + 1).padStart(2, '0')} · {frame.key}
            </span>
            {frameThreads.length > 0 && (
              <Flexbox horizontal align={'center'} gap={2}>
                <Icon color={cssVar.colorTextTertiary} icon={MessageSquare} size={12} />
                <Text fontSize={11} type={'secondary'}>
                  {frameThreads.length}
                </Text>
              </Flexbox>
            )}
          </Flexbox>
          <span {...stylex.props(styles.title)}>{frame.title}</span>
          <Flexbox horizontal gap={4} wrap={'wrap'}>
            <Tag color={FRAME_STAGE_COLOR[stage]} size={'small'}>
              {t(`frames.stage.${stage}`)}
            </Tag>
            {frame.captures.length > 0 && <SourceBadge source={'real'} />}
          </Flexbox>
        </Flexbox>
      </button>

      {frame.versions.map((version) => {
        const chosen = frame.selectedVersionId === version.id;
        const isBaseline = frame.baseline?.versionId === version.id;
        const pins = threadsForFrameTarget(frameThreads, frame.id, {
          versionId: version.id,
        }).length;
        return (
          <Flexbox
            align={'flex-start'}
            gap={6}
            key={version.id}
            {...stylex.props(
              styles.version,
              chosen && styles.chosen,
              isBaseline && styles.baseline,
            )}
          >
            {isBaseline && (
              <Tag color={'warning'} icon={<Icon icon={Lock} size={11} />} size={'small'}>
                {t('frames.baseline.badge')}
              </Tag>
            )}
            <button
              type={'button'}
              {...stylex.props(styles.reference, shown?.id === version.id && styles.shown)}
              onClick={() => {
                onActivate();
                onPreview(version.id);
              }}
            >
              <Flexbox gap={4}>
                <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0 }}>
                  <SourceBadge source={'mock'} />
                  <Text ellipsis {...stylex.props(styles.label)}>
                    {version.label}
                  </Text>
                </Flexbox>
                <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0 }}>
                  <Icon color={cssVar.colorTextTertiary} icon={LayoutTemplate} size={12} />
                  <Text ellipsis fontSize={11} type={'secondary'}>
                    {canvasRefLabel(version)}
                  </Text>
                  {pins > 0 && (
                    <Flexbox horizontal align={'center'} flex={'none'} gap={2}>
                      <Icon color={cssVar.colorTextTertiary} icon={MessageSquare} size={11} />
                      <Text fontSize={11} type={'secondary'}>
                        {pins}
                      </Text>
                    </Flexbox>
                  )}
                </Flexbox>
              </Flexbox>
            </button>
            {version.note && (
              <Text fontSize={11} type={'secondary'}>
                {version.note}
              </Text>
            )}
            {!locked &&
              (chosen ? (
                <Flexbox horizontal align={'center'} gap={4}>
                  <Icon color={cssVar.colorPrimary} icon={Check} size={13} />
                  <Text fontSize={12} style={{ color: cssVar.colorPrimary }}>
                    {t('frames.version.selected')}
                  </Text>
                </Flexbox>
              ) : (
                board.canEdit && (
                  <Button
                    block
                    size={'small'}
                    onClick={() => void onUpdate({ type: 'selectVersion', versionId: version.id })}
                  >
                    {t('frames.version.select')}
                  </Button>
                )
              ))}
          </Flexbox>
        );
      })}
    </Flexbox>
  );
};

export default FrameColumn;
