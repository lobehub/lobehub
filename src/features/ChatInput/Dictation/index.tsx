'use client';

import { Spin, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Mic, RotateCcw, X } from 'lucide-react';
import type { MouseEvent } from 'react';
import { memo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useServerConfigStore } from '@/store/serverConfig';

import { ChatInputAction } from '../ActionBar/components/ChatInputAction';
import { useChatInputStore, useStoreApi } from '../store';
import { isOtherAudioInputModeActive } from './mutualExclusion';
import { getDictationControlMode } from './presentation';
import { useDictationControlFocus } from './useDictationControlFocus';
import { useDictationPrefetch } from './useDictationPrefetch';
import { useRealtimeDictation } from './useRealtimeDictation';

const styles = stylex.create({
  cancel: { color: cssVar.colorTextSecondary },
  controlRow: { display: 'flex', flex: 'none', gap: '4px', alignItems: 'center' },
  controls: {
    display: 'flex',
    flex: 'none',
    gap: '4px',
    alignItems: 'center',
    padding: '2px',
    borderRadius: '9999px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  // The emotion version stacked `&&` to outrank the action button's own colors; the
  // button's lobe-ui styles are layered, so plain StyleX rules win without it.
  listening: {
    color: {
      'default': `contrast-color(${cssVar.colorPrimary})`,
      ':hover': `contrast-color(${cssVar.colorPrimaryHover})`,
      ':active': `contrast-color(${cssVar.colorPrimaryActive})`,
    },
    backgroundColor: {
      'default': cssVar.colorPrimary,
      ':hover': cssVar.colorPrimaryHover,
      ':active': cssVar.colorPrimaryActive,
    },
    backgroundImage: { 'default': 'none', ':hover': 'none', ':active': 'none' },
    transform: { 'default': null, ':active': 'scale(0.94)' },
    transition: {
      'default': 'color 160ms ease, background 160ms ease, transform 120ms ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineColor: { 'default': null, ':focus-visible': 'currentcolor' },
    outlineOffset: { 'default': null, ':focus-visible': '-3px' },
    boxShadow: { 'default': null, ':focus-visible': 'none' },
  },
  listeningStatus: {
    position: 'absolute',
    overflow: 'hidden',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: '0',
    borderStyle: 'none',
    whiteSpace: 'nowrap',
    clip: 'rect(0, 0, 0, 0)',
  },
  status: {
    overflow: 'hidden',
    maxWidth: '160px',
    paddingInlineStart: '6px',
    paddingInlineEnd: '2px',
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

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
  const prefetch = useDictationPrefetch(client, enabled && !mobile);
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
        onFocus={prefetch}
        onKeyDown={(event) => handleKeyboardActivation(event, start)}
        onPointerDown={prefetch}
        onPointerEnter={prefetch}
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
        {...stylex.props(styles.controlRow)}
        data-status="listening"
        data-testid="voice-dictation-controls"
        role="group"
      >
        <span aria-live="polite" {...stylex.props(styles.listeningStatus)} role="status">
          {statusText}
        </span>
        <ChatInputAction
          aria-label={t('voiceDictation.stop')}
          className={stylex.props(styles.listening).className}
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
          className={stylex.props(styles.cancel).className}
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
      {...stylex.props(styles.controlRow)}
      data-status={status}
      data-testid="voice-dictation-controls"
      role="group"
    >
      <div {...stylex.props(styles.controls)}>
        <span aria-live="polite" {...stylex.props(styles.status)} role="status">
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
            onPointerDown={prefetch}
          />
        ) : status !== 'error' ? (
          <Spin aria-hidden size="small" />
        ) : null}
      </div>
      <ChatInputAction
        aria-label={status === 'error' ? t('voiceDictation.dismiss') : t('voiceDictation.cancel')}
        className={stylex.props(styles.cancel).className}
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
