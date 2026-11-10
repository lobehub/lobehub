'use client';

import { ActionIcon, Button, Flexbox, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import {
  CircleStopIcon,
  Maximize2Icon,
  MicIcon,
  Minimize2Icon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { meetingActions, type RecorderPhase, useMeetingStore } from '@/store/meeting';

import { meetingDetailPath } from '../../paths';
import { listMicrophones, meetingRecorder, watchMicrophonePermission } from '../meetingRecorder';
import type { Point } from './dragPosition';
import LiveTranscript from './LiveTranscript';
import MicrophoneSelect from './MicrophoneSelect';
import PermissionNotice from './PermissionNotice';
import RecordingClock from './RecordingClock';
import { useDraggable } from './useDraggable';
import Waveform from './Waveform';

const DOCK_OFFSET = 24;

const styles = stylex.create({
  card: {
    width: 360,
    borderRadius: 16,
  },
  dot: {
    flex: 'none',
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: cssVar.colorTextQuaternary,
  },
  dotPaused: {
    backgroundColor: cssVar.colorWarning,
  },
  dotRecording: {
    backgroundColor: cssVar.colorError,
  },
  handle: {
    touchAction: 'none',
    cursor: 'grab',
    userSelect: 'none',
    paddingBlock: 12,
    paddingInlineStart: 16,
    paddingInlineEnd: 8,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  handleDragging: {
    cursor: 'grabbing',
  },
  pill: {
    touchAction: 'none',
    cursor: 'grab',
    userSelect: 'none',
    height: 44,
    paddingInlineStart: 16,
    paddingInlineEnd: 8,
    borderRadius: 22,
  },
  root: {
    position: 'fixed',
    zIndex: 1000,
    overflow: 'hidden',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgElevated,
    boxShadow: cssVar.boxShadowSecondary,
  },
  title: {
    overflow: 'hidden',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const isLive = (phase: RecorderPhase) => phase === 'recording' || phase === 'paused';

const StatusDot = ({ phase }: { phase: RecorderPhase }) => (
  <span
    className={
      stylex.props(
        styles.dot,
        phase === 'recording' && styles.dotRecording,
        phase === 'paused' && styles.dotPaused,
      ).className
    }
  />
);

const LiveControls = ({ compact }: { compact?: boolean }) => {
  const { t } = useTranslation('meeting');
  const phase = useMeetingStore((s) => s.recorder.phase);
  const paused = phase === 'paused';

  if (compact)
    return (
      <>
        <ActionIcon
          aria-label={paused ? t('recorder.resume') : t('recorder.pause')}
          icon={paused ? PlayIcon : PauseIcon}
          size={'small'}
          title={paused ? t('recorder.resume') : t('recorder.pause')}
          onClick={() => void (paused ? meetingRecorder.resume() : meetingRecorder.pause())}
        />
        <ActionIcon
          aria-label={t('recorder.stop')}
          icon={CircleStopIcon}
          size={'small'}
          style={{ color: cssVar.colorError }}
          title={t('recorder.stop')}
          onClick={() => void meetingRecorder.stop()}
        />
      </>
    );

  return (
    <Flexbox horizontal gap={8}>
      <Button
        block
        icon={paused ? PlayIcon : PauseIcon}
        onClick={() => void (paused ? meetingRecorder.resume() : meetingRecorder.pause())}
      >
        {paused ? t('recorder.resume') : t('recorder.pause')}
      </Button>
      <Button block danger icon={CircleStopIcon} onClick={() => void meetingRecorder.stop()}>
        {t('recorder.stop')}
      </Button>
    </Flexbox>
  );
};

const IdleBody = () => {
  const { t } = useTranslation('meeting');
  const error = useMeetingStore((s) => s.recorder.error);
  const permission = useMeetingStore((s) => s.permission);

  const start = () =>
    void meetingRecorder.start({
      title: t('recorder.defaultTitle', { date: dayjs().format('YYYY-MM-DD HH:mm') }),
    });

  return (
    <Flexbox gap={14}>
      <PermissionNotice />
      {error === 'start_failed' && (
        <AsyncError justify={'start'} title={t('recorder.startFailed')} variant={'inline'} />
      )}
      <MicrophoneSelect />
      <Button block icon={MicIcon} size={'large'} type={'primary'} onClick={start}>
        {error === 'permission_denied' || permission === 'denied'
          ? t('permission.retry')
          : t('recorder.start')}
      </Button>
    </Flexbox>
  );
};

const LiveBody = () => {
  const paused = useMeetingStore((s) => s.recorder.phase === 'paused');

  return (
    <Flexbox gap={14}>
      <Flexbox horizontal align={'center'} gap={16}>
        <RecordingClock />
        <Flexbox flex={1}>
          <Waveform height={32} paused={paused} />
        </Flexbox>
      </Flexbox>
      <LiveTranscript />
      <MicrophoneSelect disabled />
      <LiveControls />
    </Flexbox>
  );
};

const BusyBody = ({ label }: { label: string }) => (
  <Flexbox horizontal align={'center'} gap={10} paddingBlock={12}>
    <Spin size={'small'} />
    <Text type={'secondary'}>{label}</Text>
  </Flexbox>
);

const DoneBody = () => {
  const { t } = useTranslation('meeting');
  const navigate = useWorkspaceAwareNavigate();
  const meetingId = useMeetingStore((s) => s.recorder.meetingId);
  const error = useMeetingStore((s) => s.recorder.error);
  const uploadError = error === 'upload_failed' || error === 'upload_offline';

  const openMeeting = () => {
    if (!meetingId) return;
    navigate(meetingDetailPath(meetingId));
    meetingActions.closeRecorder();
  };

  return (
    <Flexbox gap={14}>
      {uploadError ? (
        <AsyncError
          justify={'start'}
          variant={'inline'}
          title={
            error === 'upload_offline'
              ? t('recorder.uploadFailedOffline')
              : t('recorder.uploadFailed')
          }
        />
      ) : (
        <Text weight={500}>{t('recorder.done.title')}</Text>
      )}
      <Flexbox horizontal gap={8}>
        {uploadError && (
          <Button block onClick={() => void meetingRecorder.retryUpload()}>
            {t('recorder.uploadRetry')}
          </Button>
        )}
        <Button block disabled={!meetingId} type={'primary'} onClick={openMeeting}>
          {t('recorder.done.view')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

/**
 * The floating meeting recorder. Mounted once by the app layout, outside the
 * routed content, so navigating never unmounts it and never stops a recording.
 */
const MeetingRecorderOverlay = () => {
  const { t } = useTranslation('meeting');
  const open = useMeetingStore((s) => s.overlay.open);
  const minimized = useMeetingStore((s) => s.overlay.minimized);
  const storedPosition = useMeetingStore((s) =>
    s.overlay.minimized ? s.overlay.pillPosition : s.overlay.position,
  );
  const phase = useMeetingStore((s) => s.recorder.phase);
  const title = useMeetingStore((s) => s.recorder.title);
  const boxRef = useRef<HTMLDivElement>(null);

  const commitPosition = useCallback((position: Point) => {
    const { minimized } = useMeetingStore.getState().overlay;
    meetingActions.setOverlay(minimized ? { pillPosition: position } : { position });
  }, []);
  const { dragging, handleProps, position } = useDraggable(boxRef, storedPosition, commitPosition);

  useEffect(() => {
    if (!open) return;
    void listMicrophones();
    return watchMicrophonePermission();
  }, [open]);

  // Closing the tab mid-meeting would drop the audio that is not uploaded yet.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused' && phase !== 'finishing') return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  if (!open) return null;

  const placement = position
    ? { left: position.x, top: position.y }
    : { bottom: DOCK_OFFSET, right: DOCK_OFFSET };
  const live = isLive(phase);
  const statusLabel =
    phase === 'recording'
      ? t('recorder.status.recording')
      : phase === 'paused'
        ? t('recorder.status.paused')
        : (title ?? t('recorder.status.idle'));
  const canClose = phase === 'idle' || phase === 'done';

  if (minimized)
    return (
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.root, styles.pill).className}
        data-testid={'meeting-recorder'}
        gap={8}
        ref={boxRef}
        style={placement}
        title={t('recorder.drag')}
        {...handleProps}
      >
        <StatusDot phase={phase} />
        {live ? (
          <>
            <RecordingClock fontSize={14} />
            <div style={{ width: 56 }}>
              <Waveform bars={14} height={18} paused={phase === 'paused'} />
            </div>
            <LiveControls compact />
          </>
        ) : (
          <Text fontSize={13} weight={500}>
            {statusLabel}
          </Text>
        )}
        <ActionIcon
          aria-label={t('recorder.expand')}
          icon={Maximize2Icon}
          size={'small'}
          title={t('recorder.expand')}
          onClick={() => meetingActions.setOverlay({ minimized: false })}
        />
      </Flexbox>
    );

  return (
    <Flexbox
      aria-label={t('live.title')}
      className={stylex.props(styles.root, styles.card).className}
      data-testid={'meeting-recorder'}
      ref={boxRef}
      role={'dialog'}
      style={placement}
    >
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.handle, dragging && styles.handleDragging).className}
        gap={8}
        title={t('recorder.drag')}
        {...handleProps}
      >
        <StatusDot phase={phase} />
        <Text className={stylex.props(styles.title).className} weight={600}>
          {statusLabel}
        </Text>
        <Flexbox flex={1} />
        <ActionIcon
          aria-label={t('recorder.minimize')}
          icon={Minimize2Icon}
          size={'small'}
          title={t('recorder.minimize')}
          onClick={() => meetingActions.setOverlay({ minimized: true })}
        />
        {canClose && (
          <ActionIcon
            aria-label={t('recorder.close')}
            icon={XIcon}
            size={'small'}
            title={t('recorder.close')}
            onClick={meetingActions.closeRecorder}
          />
        )}
      </Flexbox>
      <Flexbox padding={16}>
        {phase === 'idle' && <IdleBody />}
        {phase === 'requesting_permission' && <BusyBody label={t('permission.requesting')} />}
        {live && <LiveBody />}
        {phase === 'finishing' && <BusyBody label={t('recorder.finishing')} />}
        {phase === 'done' && <DoneBody />}
      </Flexbox>
    </Flexbox>
  );
};

export default MeetingRecorderOverlay;
