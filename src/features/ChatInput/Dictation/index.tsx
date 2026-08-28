'use client';

import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { LoaderCircle, Mic, RotateCcw, X } from 'lucide-react';
import type { MouseEvent } from 'react';
import { memo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useServerConfigStore } from '@/store/serverConfig';

import { ChatInputAction } from '../ActionBar/components/ChatInputAction';
import { useChatInputStore, useStoreApi } from '../store';
import { isOtherAudioInputModeActive } from './mutualExclusion';
import { getDictationControlMode } from './presentation';
import { useDictationControlFocus } from './useDictationControlFocus';
import { useRealtimeDictation } from './useRealtimeDictation';

const styles = createStaticStyles(({ css, cssVar }) => ({
  cancel: css`
    color: ${cssVar.colorTextSecondary};
  `,
  controlRow: css`
    display: flex;
    flex: none;
    gap: 4px;
    align-items: center;
  `,
  controls: css`
    display: flex;
    flex: none;
    gap: 4px;
    align-items: center;

    padding: 2px;
    border-radius: 9999px;

    background: ${cssVar.colorFillSecondary};
  `,
  listening: css`
    color: ${cssVar.colorWhite};

    background: ${cssVar.colorSuccess};
    box-shadow: 0 0 0 3px ${cssVar.colorSuccessBg};

    transition:
      color 160ms ease,
      background 160ms ease,
      box-shadow 160ms ease,
      transform 120ms ease;
    animation: dictation-halo-breathe 1.6s ease-in-out infinite;

    &:hover {
      color: ${cssVar.colorWhite};
      background: ${cssVar.colorSuccessHover};
      box-shadow: 0 0 0 4px ${cssVar.colorSuccessBgHover};
    }

    &:active {
      transform: scale(0.94);
      background: ${cssVar.colorSuccessActive};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorSuccess};
      outline-offset: 3px;
    }

    @keyframes dictation-halo-breathe {
      0%,
      100% {
        box-shadow: 0 0 0 3px ${cssVar.colorSuccessBg};
      }

      50% {
        box-shadow: 0 0 0 6px ${cssVar.colorSuccessBgHover};
      }
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
      animation: none;
    }
  `,
  listeningStatus: css`
    position: absolute;

    overflow: hidden;

    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;

    white-space: nowrap;

    clip: rect(0, 0, 0, 0);
  `,
  spin: css`
    animation: dictation-spin 1s linear infinite;

    @keyframes dictation-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
  status: css`
    overflow: hidden;

    max-width: 160px;
    padding-inline: 6px 2px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const Dictation = memo(() => {
  const { t } = useTranslation('chat');
  const enabled = useServerConfigStore((s) => s.featureFlags.enableVoiceDictation === true);
  const storeApi = useStoreApi();
  const [activeAudioInputMode, editor, mobile, generating, setActiveAudioInputMode] =
    useChatInputStore((s) => [
      s.activeAudioInputMode,
      s.editor,
      s.mobile,
      Boolean(s.sendButtonProps?.generating),
      s.setActiveAudioInputMode,
    ]);
  const { client, errorCode, retryable, status } = useRealtimeDictation(editor);
  const active = status !== 'idle' || activeAudioInputMode === 'dictation';
  const controlMode = getDictationControlMode(status);
  const otherAudioModeActive = isOtherAudioInputModeActive(activeAudioInputMode, 'dictation');
  const {
    actionRef,
    cancelRef,
    handleKeyboardActivation,
    preserveFocusOnActivation,
    retryRef,
    stopRef,
  } = useDictationControlFocus({ active, retryable, status });

  useEffect(() => {
    if (!client) return;
    if (status !== 'idle' && activeAudioInputMode !== 'dictation') {
      setActiveAudioInputMode('dictation');
    } else if (status === 'idle' && activeAudioInputMode === 'dictation') {
      setActiveAudioInputMode(undefined);
    }
  }, [activeAudioInputMode, client, setActiveAudioInputMode, status]);

  useEffect(
    () => () => {
      if (storeApi.getState().activeAudioInputMode === 'dictation') {
        storeApi.getState().setActiveAudioInputMode(undefined);
      }
    },
    [storeApi],
  );

  useEffect(() => {
    if (generating && active) void client?.cancel('audio_interruption');
  }, [active, client, generating]);

  useEffect(() => {
    if ((!enabled || mobile) && activeAudioInputMode === 'dictation') {
      void client?.dispose();
      setActiveAudioInputMode(undefined);
    }
  }, [activeAudioInputMode, client, enabled, mobile, setActiveAudioInputMode]);

  const start = useCallback(() => {
    if (!client || generating || otherAudioModeActive) return;
    setActiveAudioInputMode('dictation');
    void client.start();
  }, [client, generating, otherAudioModeActive, setActiveAudioInputMode]);

  const dismiss = useCallback(() => {
    void client?.dispose();
    setActiveAudioInputMode(undefined);
  }, [client, setActiveAudioInputMode]);

  const handleStart = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      preserveFocusOnActivation(event);
      start();
    },
    [preserveFocusOnActivation, start],
  );

  const handleStop = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      preserveFocusOnActivation(event);
      void client?.stop();
    },
    [client, preserveFocusOnActivation],
  );

  const handleCancel = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      preserveFocusOnActivation(event);
      void client?.cancel();
    },
    [client, preserveFocusOnActivation],
  );

  const handleDismiss = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      preserveFocusOnActivation(event);
      dismiss();
    },
    [dismiss, preserveFocusOnActivation],
  );

  if (!enabled || mobile || !client) return null;

  if (!active) {
    const disabled = generating || otherAudioModeActive;
    const title = generating
      ? t('voiceDictation.replyInProgress')
      : otherAudioModeActive
        ? t('voiceDictation.otherAudioModeActive')
        : t('voiceDictation.action');

    return disabled ? (
      <Tooltip title={title}>
        <ChatInputAction
          disabled
          aria-label={t('voiceDictation.action')}
          data-testid="voice-dictation-action"
          icon={Mic}
          ref={actionRef}
          showTooltip={false}
          title={title}
        />
      </Tooltip>
    ) : (
      <ChatInputAction
        aria-label={t('voiceDictation.action')}
        data-testid="voice-dictation-action"
        icon={Mic}
        ref={actionRef}
        title={t('voiceDictation.action')}
        onClick={handleStart}
        onKeyDown={(event) => handleKeyboardActivation(event, start)}
      />
    );
  }

  const errorText = errorCode ? t(`voiceDictation.error.${errorCode}`) : undefined;
  const statusText =
    status === 'requesting_permission'
      ? t('voiceDictation.requestingPermission')
      : status === 'connecting'
        ? t('voiceDictation.connecting')
        : status === 'listening'
          ? t('voiceDictation.listening')
          : status === 'finalizing'
            ? t('voiceDictation.finalizing')
            : errorText;

  if (controlMode === 'listening') {
    return (
      <div
        aria-label={t('voiceDictation.statusLabel')}
        className={styles.controlRow}
        data-status="listening"
        data-testid="voice-dictation-controls"
        role="group"
      >
        <span aria-live="polite" className={styles.listeningStatus} role="status">
          {statusText}
        </span>
        <ChatInputAction
          aria-label={t('voiceDictation.stop')}
          className={styles.listening}
          data-testid="voice-dictation-stop"
          icon={Mic}
          ref={stopRef}
          style={{ borderRadius: '50%' }}
          title={t('voiceDictation.stop')}
          onClick={handleStop}
          onKeyDown={(event) =>
            handleKeyboardActivation(event, () => {
              void client?.stop();
            })
          }
        />
        <ChatInputAction
          aria-label={t('voiceDictation.cancel')}
          className={styles.cancel}
          data-testid="voice-dictation-cancel"
          icon={X}
          ref={cancelRef}
          title={t('voiceDictation.cancel')}
          onClick={handleCancel}
          onKeyDown={(event) =>
            handleKeyboardActivation(event, () => {
              void client?.cancel();
            })
          }
        />
      </div>
    );
  }

  return (
    <div
      aria-label={t('voiceDictation.statusLabel')}
      className={styles.controlRow}
      data-status={status}
      data-testid="voice-dictation-controls"
      role="group"
    >
      <div className={styles.controls}>
        <span aria-live="polite" className={styles.status} role="status">
          {statusText}
        </span>
        {status === 'error' && retryable ? (
          <ChatInputAction
            aria-label={t('voiceDictation.retry')}
            data-testid="voice-dictation-retry"
            icon={RotateCcw}
            ref={retryRef}
            title={t('voiceDictation.retry')}
            onClick={handleStart}
            onKeyDown={(event) => handleKeyboardActivation(event, start)}
          />
        ) : status !== 'error' ? (
          <Icon aria-hidden className={styles.spin} icon={LoaderCircle} size={18} />
        ) : null}
      </div>
      <ChatInputAction
        aria-label={status === 'error' ? t('voiceDictation.dismiss') : t('voiceDictation.cancel')}
        className={styles.cancel}
        data-testid="voice-dictation-cancel"
        icon={X}
        ref={cancelRef}
        title={status === 'error' ? t('voiceDictation.dismiss') : t('voiceDictation.cancel')}
        onClick={status === 'error' ? handleDismiss : handleCancel}
        onKeyDown={(event) =>
          handleKeyboardActivation(event, () => {
            if (status === 'error') {
              dismiss();
              return;
            }

            void client?.cancel();
          })
        }
      />
    </div>
  );
});

Dictation.displayName = 'Dictation';

export default Dictation;
