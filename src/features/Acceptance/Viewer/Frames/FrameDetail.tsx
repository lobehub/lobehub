'use client';

import type {
  AcceptanceCommentThread,
  AcceptanceFrame,
  AcceptanceFrameBoardView,
  AcceptanceFrameOperation,
} from '@lobechat/types';
import { getAcceptanceFrameStage, isAcceptanceFrameCriteriaComplete } from '@lobechat/types';
import { Button, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Lock, LockOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { useAcceptanceComments } from '../Comments/hooks';
import { FRAME_STAGE_COLOR } from './frameBoard';
import FrameCompare from './FrameCompare';
import FrameCriteria from './FrameCriteria';

const styles = stylex.create({
  root: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
    padding: 16,
  },
  criteria: {
    flexShrink: 0,
    width: 340,
  },
  compare: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
  },
});

interface FrameDetailProps {
  board: AcceptanceFrameBoardView;
  comments: ReturnType<typeof useAcceptanceComments>;
  frame: AcceptanceFrame;
  frameThreads: AcceptanceCommentThread[];
  onUpdate: (operation: AcceptanceFrameOperation) => Promise<boolean>;
  pinMode: boolean;
  previewVersionId?: string;
}

/** The selected node in full: its acceptance points, its baseline lock, and the real comparison. */
const FrameDetail = ({
  board,
  comments,
  frame,
  frameThreads,
  onUpdate,
  pinMode,
  previewVersionId,
}: FrameDetailProps) => {
  const { t } = useTranslation('verify');
  const stage = getAcceptanceFrameStage(frame);
  const locked = Boolean(frame.baseline);
  const lockBlocker = !frame.selectedVersionId
    ? t('frames.baseline.needVersion')
    : !isAcceptanceFrameCriteriaComplete(frame.criteria)
      ? t('frames.baseline.needCriteria')
      : undefined;

  return (
    <Flexbox gap={16} {...stylex.props(styles.root)}>
      <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'}>
        <Flexbox gap={4} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={8}>
            <span {...stylex.props(styles.title)}>{frame.title}</span>
            <Tag color={FRAME_STAGE_COLOR[stage]}>{t(`frames.stage.${stage}`)}</Tag>
          </Flexbox>
          {frame.description && <Text type={'secondary'}>{frame.description}</Text>}
          {frame.baseline && (
            <Text fontSize={12} type={'secondary'}>
              {t('frames.baseline.lockedAt', {
                time: new Date(frame.baseline.lockedAt).toLocaleString(),
              })}
            </Text>
          )}
        </Flexbox>
        {board.canEdit &&
          (locked ? (
            <Button
              icon={<Icon icon={LockOpen} />}
              size={'small'}
              onClick={() => void onUpdate({ type: 'unlockBaseline' })}
            >
              {t('frames.baseline.unlock')}
            </Button>
          ) : (
            <Tooltip title={lockBlocker}>
              <Button
                disabled={Boolean(lockBlocker)}
                icon={<Icon icon={Lock} />}
                size={'small'}
                type={'primary'}
                onClick={() => void onUpdate({ type: 'lockBaseline' })}
              >
                {t('frames.baseline.lock')}
              </Button>
            </Tooltip>
          ))}
      </Flexbox>
      <Flexbox horizontal align={'flex-start'} gap={24}>
        <div {...stylex.props(styles.criteria)}>
          <FrameCriteria canEdit={board.canEdit} frame={frame} onUpdate={onUpdate} />
        </div>
        <div {...stylex.props(styles.compare)}>
          <FrameCompare
            board={board}
            comments={comments}
            frame={frame}
            frameThreads={frameThreads}
            pinMode={pinMode}
            previewVersionId={previewVersionId}
            onUpdate={onUpdate}
          />
        </div>
      </Flexbox>
    </Flexbox>
  );
};

export default FrameDetail;
