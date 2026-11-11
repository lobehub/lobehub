'use client';

import { type VoiceMessageRecording } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ArrowUp, type LucideProps, RotateCcw, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { ChatInputAction } from '../ActionBar/components/ChatInputAction';
import { useAgentId } from '../hooks/useAgentId';
import { useEffectiveModel } from '../hooks/useEffectiveModel';
import { voiceSendButtonMarker } from '../markers.stylex';
import { useChatInputStore, useStoreApi } from '../store';
import { formatVoiceDuration } from './mediaRecorder';
import { styles } from './style';
import { useIntentionalHover } from './useIntentionalHover';
import {
  getVoiceMessageActionState,
  getVoiceMessageIdleState,
  useVoiceMessageCapability,
} from './useVoiceMessageCapability';
import { useVoiceMessageRecorder } from './useVoiceMessageRecorder';

const VoiceMessageIcon = ({
  ref,
  size = 24,
  strokeWidth = 2,
  ...rest
}: LucideProps & { ref?: React.RefObject<SVGSVGElement | null> }) => (
  <svg
    fill="none"
    height={size}
    ref={ref}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={strokeWidth}
    viewBox="0 0 24 24"
    width={size}
    {...rest}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12h.01" />
    <path d="M11 9.75a3.25 3.25 0 0 1 0 4.5" />
    <path d="M14 7.5a6.25 6.25 0 0 1 0 9" />
  </svg>
);

VoiceMessageIcon.displayName = 'VoiceMessageIcon';

export interface VoiceMessageControlProps {
  actionLabel: string;
  actionText?: string;
  cancelLabel: string;
  durationLabel: string;
  errorText?: string;
  expanded?: boolean;
  groupLabel: string;
  isRetry?: boolean;
  onAction: () => void;
  onCancel: () => void;
  progress?: number;
  sendDisabled?: boolean;
  statusAnnouncement: string;
  tooltip?: string;
  waveform: number[];
}

const SendDots = ({ busy, hidden }: { busy?: boolean; hidden?: boolean }) => (
  <span aria-hidden {...stylex.props(styles.sendDots, hidden && styles.hidden)}>
    {Array.from({ length: 4 }, (_, index) => (
      <i
        key={index}
        {...stylex.props(
          styles.sendDot,
          busy && styles.sendDotBusy,
          busy && index === 1 && styles.sendDotBusySecond,
          busy && index === 2 && styles.sendDotBusyThird,
          busy && index === 3 && styles.hidden,
        )}
      />
    ))}
  </span>
);

export const VoiceMessageControl = memo<VoiceMessageControlProps>(
  ({
    actionLabel,
    actionText,
    cancelLabel,
    durationLabel,
    errorText,
    expanded,
    groupLabel,
    isRetry,
    progress,
    sendDisabled,
    statusAnnouncement,
    tooltip,
    waveform,
    onAction,
    onCancel,
  }) => {
    const sendButtonRef = useRef<HTMLButtonElement>(null);
    const { handlePointerEnter, handlePointerLeave, isHoverExpanded } =
      useIntentionalHover(sendButtonRef);

    const sendOpen = Boolean(expanded || isHoverExpanded);

    return (
      <div
        aria-label={groupLabel}
        {...stylex.props(styles.container)}
        data-testid="voice-message-recorder"
        role="group"
      >
        <span aria-live="polite" {...stylex.props(styles.visuallyHidden)}>
          {statusAnnouncement}
        </span>
        <button
          aria-label={cancelLabel}
          {...stylex.props(styles.cancelButton)}
          data-testid="voice-message-cancel"
          type="button"
          onClick={onCancel}
        >
          <Icon icon={X} size={17} />
        </button>

        <div {...stylex.props(styles.pill)} data-testid="voice-message-pill">
          <span {...stylex.props(styles.visuallyHidden)}>{durationLabel}</span>

          {errorText ? (
            <span {...stylex.props(styles.error)} title={errorText}>
              {errorText}
            </span>
          ) : (
            <div aria-hidden {...stylex.props(styles.waveform)}>
              {waveform.map((level, index) => (
                <span
                  key={index}
                  {...sx(styles.bar, {
                    height: `${Math.max(4, Math.round(level * 18))}px`,
                  })}
                />
              ))}
            </div>
          )}

          <Tooltip title={tooltip}>
            <button
              aria-label={actionLabel}
              data-error={isRetry}
              data-expanded={expanded}
              data-hover-expanded={isHoverExpanded}
              data-testid={isRetry ? 'voice-message-retry' : 'voice-message-send'}
              disabled={sendDisabled}
              ref={sendButtonRef}
              type="button"
              {...stylex.props(
                voiceSendButtonMarker,
                styles.sendButton,
                isRetry && styles.sendButtonError,
                isHoverExpanded && styles.sendButtonHoverExpanded,
                expanded && styles.sendButtonExpanded,
              )}
              onClick={onAction}
              onPointerEnter={(event) => handlePointerEnter(event.pointerType)}
              onPointerLeave={(event) => handlePointerLeave(event.pointerType)}
            >
              <span
                {...stylex.props(
                  styles.sendLabel,
                  sendOpen && styles.sendLabelOpen,
                  expanded && styles.sendLabelExpanded,
                )}
              >
                <SendDots busy={expanded} />
                <span {...stylex.props(styles.sendText, expanded && styles.hidden)}>
                  {actionText}
                </span>
                <SendDots hidden={expanded} />
              </span>
              <span {...stylex.props(styles.sendArrow, sendOpen && styles.sendArrowHidden)}>
                <Icon icon={isRetry ? RotateCcw : ArrowUp} size={18} />
              </span>
            </button>
          </Tooltip>

          {progress !== undefined && (
            <div aria-hidden {...stylex.props(styles.progress)}>
              <div {...sx(styles.progressValue, { width: `${progress}%` })} />
            </div>
          )}
        </div>
      </div>
    );
  },
);

VoiceMessageControl.displayName = 'VoiceMessageControl';

const VoiceMessage = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);
  const fallbackCanRecordVoiceMessage = useVoiceMessageCapability(model, provider, agentId);
  const storeApi = useStoreApi();
  const [
    activeAudioInputMode,
    injectedCanRecordVoiceMessage,
    onVoiceMessageSend,
    sendButtonProps,
    setActiveAudioInputMode,
  ] = useChatInputStore((s) => [
    s.activeAudioInputMode,
    s.canRecordVoiceMessage,
    s.onVoiceMessageSend,
    s.sendButtonProps,
    s.setActiveAudioInputMode,
  ]);
  const canRecordVoiceMessage = injectedCanRecordVoiceMessage ?? fallbackCanRecordVoiceMessage;
  const isGenerating = Boolean(sendButtonProps?.generating);
  const canUseVoiceMessage = canRecordVoiceMessage && !isGenerating;
  const recorder = useVoiceMessageRecorder();
  const canUseVoiceMessageRef = useRef(canUseVoiceMessage);
  canUseVoiceMessageRef.current = canUseVoiceMessage;
  const sendCommittedRef = useRef(false);

  const hasRecorderActivity = recorder.status !== 'idle';
  const isActive = activeAudioInputMode === 'voiceMessage' || hasRecorderActivity;
  const isOtherAudioModeActive =
    activeAudioInputMode !== undefined && activeAudioInputMode !== 'voiceMessage';
  const idleState = getVoiceMessageIdleState({
    canRecordVoiceMessage,
    hasSendHandler: Boolean(onVoiceMessageSend),
    isGenerating,
    isOtherAudioModeActive,
  });
  const canStart = idleState.canStart;

  useEffect(() => {
    if (hasRecorderActivity && activeAudioInputMode !== 'voiceMessage') {
      setActiveAudioInputMode('voiceMessage');
    } else if (!hasRecorderActivity && activeAudioInputMode === 'voiceMessage') {
      setActiveAudioInputMode(undefined);
    }
  }, [activeAudioInputMode, hasRecorderActivity, setActiveAudioInputMode]);

  useEffect(
    () => () => {
      if (storeApi.getState().activeAudioInputMode === 'voiceMessage') {
        storeApi.getState().setActiveAudioInputMode(undefined);
      }
    },
    [storeApi],
  );

  const discard = useCallback(() => {
    recorder.reset();
    setActiveAudioInputMode(undefined);
  }, [recorder, setActiveAudioInputMode]);

  useEffect(() => {
    if (isGenerating && isActive) discard();
  }, [discard, isActive, isGenerating]);

  const commitRecording = useCallback(
    async (captured?: VoiceMessageRecording) => {
      if (!canUseVoiceMessageRef.current || sendCommittedRef.current) return;
      sendCommittedRef.current = true;

      try {
        const voiceRecording = captured ?? recorder.recording ?? (await recorder.stop());
        if (
          !canUseVoiceMessageRef.current ||
          !voiceRecording ||
          voiceRecording.durationMs < recorder.minDurationMs
        )
          return;
        if (!onVoiceMessageSend) return;

        const accepted = onVoiceMessageSend(voiceRecording);
        if (!accepted) return;

        recorder.reset();
        setActiveAudioInputMode(undefined);
      } finally {
        sendCommittedRef.current = false;
      }
    },
    [onVoiceMessageSend, recorder, setActiveAudioInputMode],
  );

  const handleStart = useCallback(() => {
    if (!canStart || storeApi.getState().sendButtonProps?.generating) return;
    setActiveAudioInputMode('voiceMessage');
    void recorder.start();
  }, [canStart, recorder, setActiveAudioInputMode, storeApi]);

  const handleRetryPermission = useCallback(() => {
    if (!canUseVoiceMessageRef.current) return;

    recorder.reset();
    void recorder.start();
  }, [recorder]);

  if (!isActive) {
    if (idleState.hidden) return null;

    const disabledReason = isOtherAudioModeActive
      ? t('voiceMessage.otherAudioModeActive')
      : t('voiceMessage.replyInProgress');

    return canStart ? (
      <ChatInputAction
        aria-label={t('voiceMessage.action')}
        data-testid="voice-message-action"
        icon={VoiceMessageIcon}
        title={t('voiceMessage.action')}
        onClick={handleStart}
      />
    ) : (
      <Tooltip title={disabledReason}>
        <ChatInputAction
          disabled
          aria-label={t('voiceMessage.action')}
          data-testid="voice-message-action"
          icon={VoiceMessageIcon}
          showTooltip={false}
          title={t('voiceMessage.action')}
        />
      </Tooltip>
    );
  }

  const errorText = isGenerating
    ? t('voiceMessage.replyInProgress')
    : !canRecordVoiceMessage
      ? t('voiceMessage.unsupported')
      : recorder.error
        ? t(`voiceMessage.error.${recorder.error}`)
        : undefined;
  const waveform = recorder.recording?.waveform ?? recorder.waveform;
  const visibleWaveform = waveform.slice(-8);
  const canSendRecording =
    recorder.durationMs >= recorder.minDurationMs &&
    (recorder.status === 'recording' || recorder.status === 'ready');
  const { canSend, sendDisabled, showRetry } = getVoiceMessageActionState({
    canRecordVoiceMessage: canUseVoiceMessage,
    canSendRecording,
    hasRecoverableError: recorder.status === 'error',
  });
  const showBusy = recorder.status === 'requesting' || recorder.status === 'stopping';
  const statusText =
    recorder.status === 'requesting'
      ? t('voiceMessage.requesting')
      : recorder.status === 'stopping'
        ? t('voiceMessage.stopping')
        : undefined;
  const statusAnnouncement =
    errorText ??
    statusText ??
    (recorder.status === 'recording'
      ? t('voiceMessage.recording')
      : recorder.status === 'ready'
        ? t('voiceMessage.ready')
        : '');

  return (
    <VoiceMessageControl
      actionLabel={t(showRetry ? 'voiceMessage.retry' : 'voiceMessage.send')}
      cancelLabel={t(recorder.status === 'ready' ? 'voiceMessage.delete' : 'voiceMessage.cancel')}
      errorText={errorText}
      expanded={showBusy}
      groupLabel={t('voiceMessage.statusLabel')}
      isRetry={showRetry}
      sendDisabled={sendDisabled}
      statusAnnouncement={statusAnnouncement}
      waveform={visibleWaveform}
      actionText={
        showRetry ? t('input.inputCompletionError.retry') : showBusy ? statusText : t('input.send')
      }
      durationLabel={t('voiceMessage.duration', {
        duration: formatVoiceDuration(recorder.durationMs),
      })}
      tooltip={
        canUseVoiceMessage && !canSend && recorder.status === 'recording'
          ? t('voiceMessage.tooShort', { duration: recorder.minDurationMs })
          : undefined
      }
      onAction={showRetry ? handleRetryPermission : () => void commitRecording()}
      onCancel={discard}
    />
  );
});

VoiceMessage.displayName = 'VoiceMessage';

export default VoiceMessage;
