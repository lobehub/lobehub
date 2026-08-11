'use client';

import { type VoiceMessageRecording } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowUp, type LucideProps, RotateCcw, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatInputAction } from '../ActionBar/components/ChatInputAction';
import { useAgentId } from '../hooks/useAgentId';
import { useEffectiveModel } from '../hooks/useEffectiveModel';
import { useChatInputStore, useStoreApi } from '../store';
import { formatVoiceDuration } from './mediaRecorder';
import { useIntentionalHover } from './useIntentionalHover';
import { getVoiceMessageActionState, useVoiceMessageCapability } from './useVoiceMessageCapability';
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

const styles = createStaticStyles(({ css, cssVar }) => ({
  bar: css`
    width: 4px;
    min-height: 4px;
    border-radius: 9999px;

    background: ${cssVar.colorPrimary};

    transition: height 80ms linear;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  cancelButton: css`
    cursor: default;

    position: relative;

    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 9999px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};

    transition:
      color 120ms ease,
      background 120ms ease,
      transform 120ms ease;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFill};
    }

    &:active {
      transform: scale(0.96);
    }

    @media (width <= 600px) {
      &::after {
        content: '';
        position: absolute;
        inset: -6px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  container: css`
    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    width: min(300px, calc(100vw - 112px));
    min-width: min(220px, calc(100vw - 112px));
    height: 32px;
    padding-inline: 2px;

    animation: voice-message-enter 160ms ease-out;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }

    @keyframes voice-message-enter {
      from {
        transform: translateX(8px);
        opacity: 0;
      }

      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `,
  error: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 50%;
    inset-inline: 12px 44px;
    transform: translateY(-50%);

    overflow: hidden;

    font-size: ${cssVar.fontSizeSM};
    line-height: 1.3;
    color: ${cssVar.colorError};
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  pill: css`
    position: relative;

    overflow: hidden;
    flex: 1;

    min-width: 0;
    height: 100%;
    border-radius: 9999px;

    background: ${cssVar.colorFillSecondary};
  `,
  progress: css`
    position: absolute;
    z-index: 3;
    inset-block-end: 0;
    inset-inline: 6px;

    overflow: hidden;

    height: 2px;
    border-radius: 1px;

    background: ${cssVar.colorFillSecondary};
  `,
  progressValue: css`
    height: 100%;
    border-radius: inherit;

    opacity: 0.72;
    background: ${cssVar.colorBgContainer};

    transition: width 120ms linear;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  sendArrow: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 50%;
    inset-inline-end: 2px;
    transform: translateY(-50%);

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;

    opacity: 1;

    transition:
      opacity 100ms ease,
      transform 160ms ease;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  sendButton: css`
    cursor: default;

    position: absolute;
    z-index: 2;
    inset: 0;

    overflow: hidden;

    width: 100%;
    padding: 0;
    border: 0;
    border-radius: inherit;

    color: ${cssVar.colorBgContainer};

    background: transparent;

    &::before {
      content: '';

      position: absolute;
      z-index: 0;
      inset: 0;

      border-radius: inherit;

      background: ${cssVar.colorPrimary};
      clip-path: circle(14px at calc(100% - 16px) 50%);

      transition: clip-path 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    &[data-error='true']::before {
      background: ${cssVar.colorError};
    }

    &[data-hover-expanded='true']::before,
    &:focus-visible::before,
    &[data-expanded='true']::before {
      clip-path: circle(150% at calc(100% - 16px) 50%);
    }

    &[data-hover-expanded='true'] > span:first-child,
    &:focus-visible > span:first-child,
    &[data-expanded='true'] > span:first-child {
      transform: translateY(0);
      opacity: 1;
    }

    &[data-hover-expanded='true'] > span:last-child,
    &:focus-visible > span:last-child,
    &[data-expanded='true'] > span:last-child {
      transform: translateY(-50%) translateX(6px);
      opacity: 0;
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -3px;
    }

    &:disabled {
      cursor: not-allowed;
    }

    &:disabled::before {
      opacity: 0.45;
    }

    @media (prefers-reduced-motion: reduce) {
      &::before {
        transition: none;
      }
    }
  `,
  sendDots: css`
    display: inline-flex;
    gap: 3px;
    align-items: center;

    > i {
      width: 3px;
      height: 3px;
      border-radius: 9999px;
      background: currentcolor;
    }
  `,
  sendLabel: css`
    position: absolute;
    z-index: 2;
    inset: 0;
    transform: translateY(4px);

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;

    font-size: ${cssVar.fontSize};
    font-weight: ${cssVar.fontWeightStrong};

    opacity: 0;

    transition:
      opacity 100ms ease,
      transform 160ms ease;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  waveform: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset: 0;

    display: flex;
    gap: 4px;
    align-items: center;
    justify-content: center;
  `,
  visuallyHidden: css`
    position: absolute;

    overflow: hidden;

    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;

    white-space: nowrap;

    clip: rect(0, 0, 0, 0);
    clip-path: inset(50%);
  `,
}));

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

const SendDots = () => (
  <span aria-hidden className={styles.sendDots}>
    {Array.from({ length: 4 }, (_, index) => (
      <i key={index} />
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

    return (
      <div
        aria-label={groupLabel}
        className={styles.container}
        data-testid="voice-message-recorder"
        role="group"
      >
        <span aria-live="polite" className={styles.visuallyHidden}>
          {statusAnnouncement}
        </span>
        <button
          aria-label={cancelLabel}
          className={styles.cancelButton}
          data-testid="voice-message-cancel"
          type="button"
          onClick={onCancel}
        >
          <Icon icon={X} size={17} />
        </button>

        <div className={styles.pill} data-testid="voice-message-pill">
          <span className={styles.visuallyHidden}>{durationLabel}</span>

          {errorText ? (
            <span className={styles.error} title={errorText}>
              {errorText}
            </span>
          ) : (
            <div aria-hidden className={styles.waveform}>
              {waveform.map((level, index) => (
                <span
                  className={styles.bar}
                  key={index}
                  style={{ height: `${Math.max(4, Math.round(level * 18))}px` }}
                />
              ))}
            </div>
          )}

          <Tooltip title={tooltip}>
            <button
              aria-label={actionLabel}
              className={styles.sendButton}
              data-error={isRetry}
              data-expanded={expanded}
              data-hover-expanded={isHoverExpanded}
              data-testid={isRetry ? 'voice-message-retry' : 'voice-message-send'}
              disabled={sendDisabled}
              ref={sendButtonRef}
              type="button"
              onClick={onAction}
              onPointerEnter={(event) => handlePointerEnter(event.pointerType)}
              onPointerLeave={(event) => handlePointerLeave(event.pointerType)}
            >
              <span className={styles.sendLabel}>
                <SendDots />
                <span>{actionText}</span>
                <SendDots />
              </span>
              <span className={styles.sendArrow}>
                <Icon icon={isRetry ? RotateCcw : ArrowUp} size={18} />
              </span>
            </button>
          </Tooltip>

          {progress !== undefined && (
            <div aria-hidden className={styles.progress}>
              <div className={styles.progressValue} style={{ width: `${progress}%` }} />
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
  const fallbackCanRecordVoiceMessage = useVoiceMessageCapability(model, provider);
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
  const canStart = canUseVoiceMessage && Boolean(onVoiceMessageSend) && !isOtherAudioModeActive;

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
    const disabledReason = isOtherAudioModeActive
      ? t('voiceMessage.otherAudioModeActive')
      : isGenerating
        ? t('voiceMessage.replyInProgress')
        : t('voiceMessage.unsupported');

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
