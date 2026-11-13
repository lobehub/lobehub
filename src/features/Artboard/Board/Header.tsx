import { ActionIcon, Button, Flexbox, Icon, Segmented, Tag, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ClipboardCheckIcon,
  ListTreeIcon,
  LockIcon,
  Maximize2Icon,
  MessageCirclePlusIcon,
  Minimize2Icon,
  MousePointer2Icon,
  StampIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import { nextQuestion, waitingQuestions } from '../data/commentModel';
import { useArtboardComments } from '../data/useArtboardComments';
import { createFinalizeModal } from '../Finalize';
import OpenConversation from '../Gallery/OpenConversation';
import { artboardActions, useArtboardStore } from '../store';
import type { BoardMode } from '../types';
import PageMenu from './PageMenu';
import { useTitleBarInset } from './useTitleBarInset';

const BAR_PADDING = 12;

const styles = stylex.create({
  bar: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    flex: 'none',
    minHeight: 44,
    paddingBlock: 6,
    paddingInline: BAR_PADDING,
  },
});

interface HeaderProps {
  narrow: boolean;
  onExitFullscreen?: () => void;
}

const Header = ({ narrow, onExitFullscreen }: HeaderProps) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const { finalized } = board;
  const trafficLightPadding = useTitleBarInset();
  const bar = sx(
    styles.bar,
    onExitFullscreen ? { paddingInlineStart: BAR_PADDING + trafficLightPadding } : {},
  );
  const pendingLeft = board.blockers.length;
  const hasTask = !!board.artboard.taskId;
  const { data: threads = [] } = useArtboardComments(board.artboard.id);
  const waiting = waitingQuestions(threads).length;
  const { gallery, mode, outlineOpen, tool, verifyOpen } = useArtboardStore((s) => ({
    gallery: s.gallery,
    mode: s.mode,
    outlineOpen: s.outlineOpen,
    tool: s.tool,
    verifyOpen: s.verifyOpen,
  }));

  const showNextQuestion = () => {
    const next = nextQuestion(threads, useArtboardStore.getState().openThreadId);
    if (next) artboardActions.showThread(next);
  };

  const identity = (
    <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
      {!narrow && (
        <ActionIcon
          active={outlineOpen}
          disabled={mode === 'verify'}
          icon={ListTreeIcon}
          size={'small'}
          title={t('artboard.header.outline')}
          onClick={() => artboardActions.setOutlineOpen(!outlineOpen)}
        />
      )}
      <Text ellipsis strong style={{ minWidth: 0 }}>
        {board.artboard.title}
      </Text>
      {(narrow || !outlineOpen || mode === 'verify') && <PageMenu />}
      <Tag size={'small'} style={{ flex: 'none' }}>
        {finalized ? t('artboard.header.phaseFinalized') : t('artboard.header.phaseDraft')}
      </Tag>
    </Flexbox>
  );
  const review = (
    <Flexbox horizontal align={'center'} gap={8}>
      {waiting > 0 && (
        <Tag
          color={'warning'}
          size={'small'}
          style={{ cursor: 'pointer', flex: 'none' }}
          onClick={showNextQuestion}
        >
          {t('artboard.header.questions', { count: waiting })}
        </Tag>
      )}
      {mode === 'discuss' && (
        <Flexbox horizontal gap={2}>
          <ActionIcon
            active={tool === 'select'}
            icon={MousePointer2Icon}
            size={'small'}
            title={t('artboard.tool.select')}
            onClick={() => artboardActions.setTool('select')}
          />
          <ActionIcon
            active={tool === 'comment'}
            icon={MessageCirclePlusIcon}
            size={'small'}
            title={t('artboard.tool.comment')}
            onClick={() => artboardActions.setTool('comment')}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
  const stage = (
    <Flexbox horizontal align={'center'} gap={8}>
      <Segmented
        size={'small'}
        value={mode}
        options={[
          { label: t('artboard.header.discuss'), value: 'discuss' },
          {
            disabled: !finalized,
            label: t('artboard.header.verify'),
            title: finalized ? undefined : t('artboard.header.verifyLocked'),
            value: 'verify',
          },
        ]}
        onChange={(value) => artboardActions.setMode(value as BoardMode)}
      />
      {finalized ? (
        <Tag color={'success'} icon={<Icon icon={LockIcon} />} size={'small'}>
          {t('artboard.header.finalized')}
        </Tag>
      ) : (
        <Tooltip title={hasTask ? undefined : t('artboard.header.noTask')}>
          <Button
            disabled={!hasTask}
            icon={StampIcon}
            size={'small'}
            type={'primary'}
            onClick={() => createFinalizeModal(board.artboard.id)}
          >
            {narrow
              ? t('artboard.header.finalizeShort')
              : pendingLeft
                ? t('artboard.header.finalizePending', { count: pendingLeft })
                : t('artboard.header.finalize')}
          </Button>
        </Tooltip>
      )}
    </Flexbox>
  );
  const windowActions = (
    <Flexbox horizontal align={'center'} gap={8}>
      {mode === 'verify' && (
        <ActionIcon
          active={verifyOpen}
          icon={ClipboardCheckIcon}
          size={'small'}
          title={t('artboard.header.verifyPanel')}
          onClick={() => artboardActions.setVerifyOpen(!verifyOpen)}
        />
      )}
      {gallery && <OpenConversation onLeave={onExitFullscreen} />}
      <ActionIcon
        icon={onExitFullscreen ? Minimize2Icon : Maximize2Icon}
        size={'small'}
        title={t(
          onExitFullscreen ? 'artboard.header.exitFullscreen' : 'artboard.header.fullscreen',
        )}
        onClick={onExitFullscreen ?? (() => artboardActions.setFullscreen(true))}
      />
    </Flexbox>
  );

  if (narrow)
    return (
      <Flexbox gap={6} {...bar}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          {identity}
          {windowActions}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          {review}
          {stage}
        </Flexbox>
      </Flexbox>
    );

  return (
    <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} {...bar}>
      {identity}
      <Flexbox horizontal align={'center'} gap={8}>
        {review}
        {stage}
        {windowActions}
      </Flexbox>
    </Flexbox>
  );
};

export default Header;
