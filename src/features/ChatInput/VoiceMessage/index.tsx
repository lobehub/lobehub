'use client';

import { type UploadFileItem } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { AudioLines, RotateCcw, Send, Trash2, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useVisualMediaUploadAbility } from '@/hooks/useVisualMediaUploadAbility';
import { useFileStore } from '@/store/file';

import { ChatInputAction } from '../ActionBar/components/ChatInputAction';
import { useAgentId } from '../hooks/useAgentId';
import { useEffectiveModel } from '../hooks/useEffectiveModel';
import { useChatInputStore, useStoreApi } from '../store';
import { formatVoiceDuration } from './mediaRecorder';
import { useVoiceMessageRecorder, type VoiceRecording } from './useVoiceMessageRecorder';

const styles = createStaticStyles(({ css, cssVar }) => ({
  bar: css`
    flex: 1;

    min-width: 2px;
    border-radius: 2px;

    background: ${cssVar.colorTextTertiary};

    transition: height 80ms linear;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  button: css`
    cursor: default;

    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    background: transparent;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    &:hover:not(:disabled) {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    @media (width <= 600px) {
      width: 44px;
      height: 44px;
    }
  `,
  container: css`
    position: relative;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    width: min(300px, calc(100vw - 112px));
    min-width: min(220px, calc(100vw - 112px));
    height: 38px;
    padding-inline: 2px;
    border-radius: 10px;

    background: ${cssVar.colorFillQuaternary};

    @media (width <= 600px) {
      height: 46px;
    }
  `,
  error: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 12px;
    line-height: 1.3;
    color: ${cssVar.colorError};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  progress: css`
    position: absolute;
    inset-block-end: 0;
    inset-inline: 4px;

    overflow: hidden;

    height: 2px;
    border-radius: 1px;

    background: ${cssVar.colorFillSecondary};
  `,
  progressValue: css`
    height: 100%;
    border-radius: inherit;
    background: ${cssVar.colorPrimary};
    transition: width 120ms linear;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  sendButton: css`
    color: ${cssVar.colorBgContainer};
    background: ${cssVar.colorText};

    &:hover:not(:disabled) {
      color: ${cssVar.colorBgContainer};
      background: ${cssVar.colorTextSecondary};
    }
  `,
  status: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  time: css`
    flex: none;

    min-width: 34px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
    text-align: end;
  `,
  waveform: css`
    display: flex;
    flex: 1;
    gap: 2px;
    align-items: center;

    min-width: 64px;
    height: 26px;
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

type UploadStatus = 'idle' | 'uploading' | 'failed';

const VoiceMessage = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);
  const { canUploadAudio } = useVisualMediaUploadAbility(model, provider, agentId);
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const storeApi = useStoreApi();
  const [activeAudioInputMode, onVoiceMessageSend, setActiveAudioInputMode] = useChatInputStore(
    (s) => [s.activeAudioInputMode, s.onVoiceMessageSend, s.setActiveAudioInputMode],
  );
  const recorder = useVoiceMessageRecorder();
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const uploadRequestIdRef = useRef(0);

  const isActive = recorder.status !== 'idle' || uploadStatus !== 'idle';
  const isOtherAudioModeActive =
    activeAudioInputMode !== undefined && activeAudioInputMode !== 'voiceMessage';
  const canStart = canUploadAudio && Boolean(onVoiceMessageSend) && !isOtherAudioModeActive;

  useEffect(() => {
    if (isActive) {
      setActiveAudioInputMode('voiceMessage');
    } else if (activeAudioInputMode === 'voiceMessage') {
      setActiveAudioInputMode(undefined);
    }
  }, [activeAudioInputMode, isActive, setActiveAudioInputMode]);

  useEffect(
    () => () => {
      uploadRequestIdRef.current += 1;
      abortControllerRef.current?.abort();
      if (storeApi.getState().activeAudioInputMode === 'voiceMessage') {
        storeApi.getState().setActiveAudioInputMode(undefined);
      }
    },
    [storeApi],
  );

  const discard = useCallback(() => {
    uploadRequestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = undefined;
    setUploadProgress(0);
    setUploadStatus('idle');
    recorder.reset();
  }, [recorder]);

  const uploadAndSend = useCallback(
    async (captured?: VoiceRecording) => {
      const voiceRecording = captured ?? recorder.recording ?? (await recorder.stop());
      if (!voiceRecording || voiceRecording.durationMs < recorder.minDurationMs) return;

      const requestId = uploadRequestIdRef.current + 1;
      uploadRequestIdRef.current = requestId;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setUploadProgress(0);
      setUploadStatus('uploading');

      try {
        const result = await uploadWithProgress({
          abortController,
          file: voiceRecording.file,
          fileMetadata: {
            codec: voiceRecording.codec,
            durationMs: voiceRecording.durationMs,
            mimeType: voiceRecording.mimeType,
          },
          onStatusUpdate: (event) => {
            if (event.type !== 'updateFile' || requestId !== uploadRequestIdRef.current) return;
            if (event.value.uploadState) setUploadProgress(event.value.uploadState.progress);
          },
        });

        if (requestId !== uploadRequestIdRef.current) return;
        if (!result) throw new Error('Voice message upload did not return a file');

        const uploadItem: UploadFileItem = {
          audioMetadata: {
            codec: voiceRecording.codec,
            durationMs: voiceRecording.durationMs,
            mimeType: voiceRecording.mimeType,
          },
          file: voiceRecording.file,
          fileUrl: result.url,
          id: result.id,
          status: 'success',
        };

        await onVoiceMessageSend?.(uploadItem);
        if (requestId !== uploadRequestIdRef.current) return;

        setUploadProgress(0);
        setUploadStatus('idle');
        recorder.reset();
      } catch {
        if (requestId !== uploadRequestIdRef.current) return;
        setUploadStatus('failed');
      } finally {
        if (requestId === uploadRequestIdRef.current) abortControllerRef.current = undefined;
      }
    },
    [onVoiceMessageSend, recorder, uploadWithProgress],
  );

  const handleStart = useCallback(() => {
    if (!canStart) return;
    setUploadStatus('idle');
    void recorder.start();
  }, [canStart, recorder]);

  const handleRetryPermission = useCallback(() => {
    recorder.reset();
    void recorder.start();
  }, [recorder]);

  if (!isActive) {
    const disabledReason = isOtherAudioModeActive
      ? t('voiceMessage.otherAudioModeActive')
      : t('voiceMessage.unsupported');

    return canStart ? (
      <ChatInputAction
        aria-label={t('voiceMessage.action')}
        data-testid="voice-message-action"
        icon={AudioLines}
        title={t('voiceMessage.action')}
        onClick={handleStart}
      />
    ) : (
      <Tooltip title={disabledReason}>
        <ChatInputAction
          disabled
          aria-label={t('voiceMessage.action')}
          data-testid="voice-message-action"
          icon={AudioLines}
          showTooltip={false}
          title={t('voiceMessage.action')}
        />
      </Tooltip>
    );
  }

  const errorText =
    uploadStatus === 'failed'
      ? t('voiceMessage.uploadFailed')
      : recorder.error
        ? t(`voiceMessage.error.${recorder.error}`)
        : undefined;
  const waveform = recorder.recording?.waveform ?? recorder.waveform;
  const showWaveform =
    recorder.status === 'recording' ||
    recorder.status === 'stopping' ||
    recorder.status === 'ready' ||
    uploadStatus !== 'idle';
  const canSend =
    uploadStatus !== 'uploading' &&
    recorder.durationMs >= recorder.minDurationMs &&
    (recorder.status === 'recording' || recorder.status === 'ready');
  const statusText =
    recorder.status === 'requesting'
      ? t('voiceMessage.requesting')
      : recorder.status === 'stopping'
        ? t('voiceMessage.stopping')
        : uploadStatus === 'uploading'
          ? t('voiceMessage.uploading')
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
    <div
      aria-label={t('voiceMessage.statusLabel')}
      className={styles.container}
      data-testid="voice-message-recorder"
      role="group"
    >
      <span aria-live="polite" className={styles.visuallyHidden}>
        {statusAnnouncement}
      </span>
      <button
        aria-label={t(uploadStatus === 'failed' ? 'voiceMessage.delete' : 'voiceMessage.cancel')}
        className={styles.button}
        data-testid="voice-message-cancel"
        type="button"
        onClick={discard}
      >
        <Icon icon={uploadStatus === 'failed' ? Trash2 : X} size={17} />
      </button>

      {errorText ? (
        <span className={styles.error} title={errorText}>
          {errorText}
        </span>
      ) : showWaveform ? (
        <>
          <div aria-hidden className={styles.waveform}>
            {waveform.map((level, index) => (
              <span
                className={styles.bar}
                key={index}
                style={{ height: `${Math.round(level * 100)}%` }}
              />
            ))}
          </div>
          <span
            className={styles.time}
            aria-label={t('voiceMessage.duration', {
              duration: formatVoiceDuration(recorder.durationMs),
            })}
          >
            {formatVoiceDuration(recorder.durationMs)}
          </span>
        </>
      ) : (
        <span className={styles.status}>{statusText}</span>
      )}

      {uploadStatus === 'failed' || recorder.status === 'error' ? (
        <button
          aria-label={t('voiceMessage.retry')}
          className={styles.button}
          data-testid="voice-message-retry"
          type="button"
          onClick={
            uploadStatus === 'failed'
              ? () => void uploadAndSend(recorder.recording)
              : handleRetryPermission
          }
        >
          <Icon icon={RotateCcw} size={17} />
        </button>
      ) : (
        <Tooltip
          title={
            !canSend && recorder.status === 'recording'
              ? t('voiceMessage.tooShort', { duration: recorder.minDurationMs })
              : undefined
          }
        >
          <button
            aria-label={t('voiceMessage.send')}
            className={`${styles.button} ${styles.sendButton}`}
            data-testid="voice-message-send"
            disabled={!canSend}
            type="button"
            onClick={() => void uploadAndSend()}
          >
            <Icon icon={Send} size={16} />
          </button>
        </Tooltip>
      )}

      {uploadStatus === 'uploading' && (
        <div aria-hidden className={styles.progress}>
          <div className={styles.progressValue} style={{ width: `${uploadProgress}%` }} />
        </div>
      )}
    </div>
  );
});

VoiceMessage.displayName = 'VoiceMessage';

export default VoiceMessage;
