import { ActionIcon, Button, Flexbox, Segmented, Tooltip } from '@lobehub/ui';
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
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDensityTokens, useHeaderActionSize } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';
import { electronStylish } from '@/styles/electron';
import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import { nextQuestion, waitingQuestions } from '../data/commentModel';
import { useArtboardComments } from '../data/useArtboardComments';
import { createFinalizeModal } from '../Finalize';
import OpenConversation from '../Gallery/OpenConversation';
import { artboardActions, useArtboardStore } from '../store';
import type { BoardMode, VerifyView } from '../types';
import { floatStyles } from '../Viewport/floatStyles';
import { headerChrome } from './headerChrome';
import PageMenu from './PageMenu';
import ShareButton from './ShareButton';
import { useTitleBarInset } from './useTitleBarInset';

const BAR_PADDING = 10;

const styles = stylex.create({
  bar: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    flex: 'none',
    fontSize: sidebarRow.textFontSize,
    minHeight: sidebarRow.headerHeight,
    paddingBlock: 4,
    paddingInline: BAR_PADDING,
  },
  chip: {
    alignItems: 'center',
    borderRadius: sidebarRow.radius,
    display: 'flex',
    flex: 'none',
    fontWeight: 500,
    gap: 6,
    height: 26,
    paddingInline: 8,
    whiteSpace: 'nowrap',
  },
  questions: {
    backgroundColor: {
      ':hover': cssVar.colorWarningBgHover,
      'default': cssVar.colorWarningBg,
    },
    borderWidth: 0,
    color: cssVar.colorWarningText,
    fontSize: sidebarRow.textFontSize,
  },
  finalized: {
    backgroundColor: cssVar.colorSuccessBg,
    color: cssVar.colorSuccessText,
  },
  finalize: {
    borderRadius: sidebarRow.radius,
    fontWeight: 500,
    height: sidebarRow.controlHeight,
    paddingInline: 12,
  },
});

interface HeaderProps {
  narrow: boolean;
  /** The board is in the Works modal; the header closes it. */
  onClose?: () => void;
  /** The board covers the whole window; the header returns it to the side panel. */
  onExitFullscreen?: () => void;
}

const Header = ({ narrow, onClose, onExitFullscreen }: HeaderProps) => {
  const { t } = useTranslation(['project', 'common']);
  const { radius } = useDensityTokens();
  const headerActionSize = useHeaderActionSize();
  const toolSize = { ...headerActionSize, borderRadius: radius, strokeWidth: 1.75 };
  const board = useBoard();
  const { finalized } = board;
  const { coversWindow, exit } = headerChrome({ onClose, onExitFullscreen });
  const trafficLightPadding = useTitleBarInset();
  const bar = sx(
    styles.bar,
    coversWindow ? electronStylish.draggable : undefined,
    coversWindow ? { paddingInlineStart: BAR_PADDING + trafficLightPadding } : {},
  );
  const nodrag = coversWindow ? electronStylish.nodrag : undefined;
  const exitButton = {
    close: { icon: XIcon, onClick: onClose, title: t('close', { ns: 'common' }) },
    enterFullscreen: {
      icon: Maximize2Icon,
      onClick: () => artboardActions.setFullscreen(true),
      title: t('artboard.header.fullscreen'),
    },
    exitFullscreen: {
      icon: Minimize2Icon,
      onClick: onExitFullscreen,
      title: t('artboard.header.exitFullscreen'),
    },
  }[exit];
  const pendingLeft = board.blockers.length;
  const hasTask = !!board.artboard.taskId;
  const { data: threads = [] } = useArtboardComments(board.artboard.id);
  const waiting = waitingQuestions(threads).length;
  const { gallery, mode, outlineOpen, tool, verifyOpen, verifyView } = useArtboardStore((s) => ({
    gallery: s.gallery,
    mode: s.mode,
    outlineOpen: s.outlineOpen,
    tool: s.tool,
    verifyOpen: s.verifyOpen,
    verifyView: s.verifyView,
  }));
  const divider = <span {...stylex.props(floatStyles.divider)} />;

  const showNextQuestion = () => {
    const next = nextQuestion(threads, useArtboardStore.getState().openThreadId);
    if (next) artboardActions.showThread(next);
  };

  const identity = (
    <Flexbox horizontal align={'center'} gap={2} style={{ minWidth: 0 }}>
      <ActionIcon
        active={outlineOpen}
        aria-expanded={outlineOpen}
        className={nodrag}
        disabled={mode === 'verify'}
        icon={ListTreeIcon}
        size={toolSize}
        title={t('artboard.header.outline')}
        onClick={() => artboardActions.setOutlineOpen(!outlineOpen)}
      />
      {!narrow && divider}
      <PageMenu className={nodrag} />
    </Flexbox>
  );
  const review = (
    <Flexbox horizontal align={'center'} className={nodrag} gap={2}>
      {mode === 'verify' && (
        <Segmented
          size={'small'}
          value={verifyView}
          options={[
            { label: t('artboard.verifyBar.board'), value: 'board' },
            { label: t('artboard.verifyBar.list'), value: 'list' },
          ]}
          onChange={(value) => artboardActions.setVerifyView(value as VerifyView)}
        />
      )}
      {mode === 'discuss' && (
        <>
          <ActionIcon
            active={tool === 'select'}
            icon={MousePointer2Icon}
            size={toolSize}
            title={t('artboard.tool.select')}
            onClick={() => artboardActions.setTool('select')}
          />
          <ActionIcon
            active={tool === 'comment'}
            icon={MessageCirclePlusIcon}
            size={toolSize}
            title={t('artboard.tool.comment')}
            onClick={() => artboardActions.setTool('comment')}
          />
        </>
      )}
      {waiting > 0 && (
        <>
          {divider}
          <Button {...stylex.props(styles.chip, styles.questions)} onClick={showNextQuestion}>
            {t('artboard.header.questions', { count: waiting })}
          </Button>
        </>
      )}
    </Flexbox>
  );
  const stage = (
    <Flexbox horizontal align={'center'} className={nodrag} gap={8}>
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
        <span {...stylex.props(styles.chip, styles.finalized)}>
          <LockIcon size={13} strokeWidth={2} />
          {t('artboard.header.finalized')}
        </span>
      ) : (
        <Tooltip title={hasTask ? undefined : t('artboard.header.noTask')}>
          <Button
            disabled={!hasTask}
            icon={StampIcon}
            type={'primary'}
            {...stylex.props(styles.finalize)}
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
    <Flexbox horizontal align={'center'} className={nodrag} gap={2}>
      {mode === 'verify' && (
        <ActionIcon
          active={verifyOpen}
          icon={ClipboardCheckIcon}
          size={toolSize}
          title={t('artboard.header.verifyPanel')}
          onClick={() => artboardActions.setVerifyOpen(!verifyOpen)}
        />
      )}
      {gallery && <OpenConversation onLeave={onClose} />}
      <ActionIcon
        icon={exitButton.icon}
        size={toolSize}
        title={exitButton.title}
        onClick={exitButton.onClick}
      />
      <ShareButton compact={narrow} />
    </Flexbox>
  );

  if (narrow)
    return (
      <Flexbox gap={4} {...bar}>
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
      <Flexbox horizontal align={'center'} gap={2}>
        {review}
        {divider}
        {stage}
        {divider}
        {windowActions}
      </Flexbox>
    </Flexbox>
  );
};

export default Header;
