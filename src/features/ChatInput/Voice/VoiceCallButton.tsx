'use client';

import { Alert, Button, Flexbox, Modal, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { AudioWaveform, Mic, MicOff, PhoneOff } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { voiceService } from '@/services/voice';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../hooks/useAgentId';
import { useChatInputStore } from '../store';
import {
  cancelBrowserSpeech,
  canUseBrowserSpeechRecognition,
  speakWithBrowser,
} from './browserVoice';
import CircularVoiceAction from './CircularVoiceAction';
import type { VoiceCallStatus, VoiceConversationRuntime } from './types';
import { useBrowserSTT, useSTTErrorHandler } from './useChatInputSpeechRecognition';

type NativeVoiceProvider = 'openai' | 'gemini' | 'xai' | 'openrouter';

interface NativeSession {
  cleanup: () => void;
  setMuted: (muted: boolean) => void;
}

const styles = createStaticStyles(({ css }) => ({
  callButton: css`
    position: relative;

    &::after {
      content: '';

      position: absolute;
      inset: 7px;

      border: 1px solid ${cssVar.colorPrimary};
      border-radius: 50%;

      opacity: 0.28;
    }
  `,
  callButtonActive: css`
    color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};

    &::after {
      opacity: 0.52;
      animation: voice-call-pulse 1.4s ease-in-out infinite;
    }

    @keyframes voice-call-pulse {
      0%,
      100% {
        transform: scale(0.9);
      }

      50% {
        transform: scale(1.25);
      }
    }
  `,
  panel: css`
    width: 100%;
  `,
  transcript: css`
    overflow: auto;

    min-height: 92px;
    max-height: 180px;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  wave: css`
    height: 92px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;
    background: radial-gradient(circle, ${cssVar.colorPrimaryBg} 0%, transparent 68%);
  `,
  waveBar: css`
    width: 4px;
    height: 18px;
    border-radius: 999px;

    background: ${cssVar.colorPrimary};

    animation: voice-wave 1s ease-in-out infinite;

    &:nth-child(2) {
      height: 34px;
      animation-delay: 0.12s;
    }

    &:nth-child(3) {
      height: 48px;
      animation-delay: 0.24s;
    }

    &:nth-child(4) {
      height: 28px;
      animation-delay: 0.36s;
    }

    &:nth-child(5) {
      height: 40px;
      animation-delay: 0.48s;
    }

    @keyframes voice-wave {
      0%,
      100% {
        transform: scaleY(0.55);
        opacity: 0.45;
      }

      50% {
        transform: scaleY(1);
        opacity: 1;
      }
    }
  `,
}));

const providerAliasMap: Record<string, NativeVoiceProvider | undefined> = {
  gemini: 'gemini',
  google: 'gemini',
  openai: 'openai',
  openrouter: 'openrouter',
  xai: 'xai',
};

const resolveNativeProvider = (
  configuredProvider: string,
  currentProvider?: string,
): NativeVoiceProvider | undefined => {
  if (configuredProvider !== 'auto') return providerAliasMap[configuredProvider];

  return currentProvider ? providerAliasMap[currentProvider] : undefined;
};

const startOpenAIRealtimeSession = async (model: string): Promise<NativeSession> => {
  if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is not available in this browser');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const peerConnection = new RTCPeerConnection();
  const remoteAudio = new Audio();
  remoteAudio.autoplay = true;

  for (const track of stream.getAudioTracks()) {
    peerConnection.addTrack(track, stream);
  }

  peerConnection.ontrack = (event) => {
    const [remoteStream] = event.streams;
    if (remoteStream) remoteAudio.srcObject = remoteStream;
  };

  peerConnection.createDataChannel('oai-events');

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  if (!offer.sdp) throw new Error('Failed to create WebRTC offer');

  const answer = await voiceService.createOpenAIRealtimeCall({ model, sdp: offer.sdp });
  await peerConnection.setRemoteDescription({ sdp: answer, type: 'answer' });

  return {
    cleanup: () => {
      for (const track of stream.getTracks()) track.stop();
      peerConnection.close();
      remoteAudio.pause();
      remoteAudio.srcObject = null;
    },
    setMuted: (muted) => {
      for (const track of stream.getAudioTracks()) track.enabled = !muted;
    },
  };
};

const statusI18nKey: Record<VoiceCallStatus, string> = {
  active: 'voice.call.status.active',
  connecting: 'voice.call.status.connecting',
  error: 'voice.call.status.error',
  idle: 'voice.call.status.idle',
  listening: 'voice.call.status.listening',
  processing: 'voice.call.status.processing',
  speaking: 'voice.call.status.speaking',
};

const VoiceWave = memo<{ active?: boolean }>(({ active }) => (
  <Flexbox horizontal align={'center'} className={styles.wave} gap={6} justify={'center'}>
    {active ? (
      <>
        <div className={styles.waveBar} />
        <div className={styles.waveBar} />
        <div className={styles.waveBar} />
        <div className={styles.waveBar} />
        <div className={styles.waveBar} />
      </>
    ) : (
      <AudioWaveform size={42} />
    )}
  </Flexbox>
));

VoiceWave.displayName = 'VoiceWave';

interface VoiceCallPanelProps {
  currentProvider?: string;
  onClose: () => void;
  runtime?: VoiceConversationRuntime;
}

const VoiceCallPanel = memo<VoiceCallPanelProps>(({ currentProvider, onClose, runtime }) => {
  const { t } = useTranslation('chat');
  const [status, setStatus] = useState<VoiceCallStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [assistantText, setAssistantText] = useState('');
  const [error, setError] = useState<string>();
  const [muted, setMuted] = useState(false);
  const [nativeSession, setNativeSession] = useState<NativeSession>();
  const transcriptRef = useRef('');
  const activeRef = useRef(false);
  const wasRecordingRef = useRef(false);
  const nativeSessionRef = useRef<NativeSession>();
  const ttsSettings = useUserStore(settingsSelectors.currentTTS, isEqual);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const { handleSuccess, setDefaultError } = useSTTErrorHandler(() => undefined);

  const nativeProvider = useMemo(
    () => resolveNativeProvider(ttsSettings.voiceCall.provider, currentProvider),
    [currentProvider, ttsSettings.voiceCall.provider],
  );

  const canTryNative =
    !enableBusinessFeatures &&
    ttsSettings.voiceCall.mode !== 'browser' &&
    nativeProvider === 'openai' &&
    typeof RTCPeerConnection !== 'undefined';

  const shouldFallbackToBrowser = ttsSettings.voiceCall.mode !== 'provider';

  const { start, isLoading, stop, formattedTime, time, response, isRecording } = useBrowserSTT({
    onError: (err) => {
      stop();
      setDefaultError(err);
      setError(t('voice.call.error.browser'));
      setStatus('error');
    },
    onErrorRetry: (err) => {
      stop();
      setDefaultError(err);
      setError(t('voice.call.error.browser'));
      setStatus('error');
    },
    onSuccess: async () => {
      await handleSuccess(response, stop);
    },
    onTextChange: (text) => {
      transcriptRef.current = text;
      setTranscript(text);
    },
  });

  const stopNativeSession = useCallback(() => {
    nativeSessionRef.current?.cleanup();
    nativeSessionRef.current = undefined;
    setNativeSession(undefined);
  }, []);

  const speakAssistantText = useCallback(
    async (text: string) => {
      if (!ttsSettings.voiceCall.autoSpeak || !text.trim()) return;

      setStatus('speaking');
      await speakWithBrowser(text);
    },
    [ttsSettings.voiceCall.autoSpeak],
  );

  const sendTranscript = useCallback(
    async (value: string) => {
      const message = value.trim();
      if (!message || !runtime) return;

      setStatus('processing');
      setAssistantText('');
      await runtime.sendTurn(message);

      const responseText = runtime.getLatestAssistantText?.()?.trim() || '';
      setAssistantText(responseText);
      await speakAssistantText(responseText);

      transcriptRef.current = '';
      setTranscript('');

      if (activeRef.current) {
        setStatus('listening');
        start();
      } else {
        setStatus('idle');
      }
    },
    [runtime, speakAssistantText, start],
  );

  useEffect(() => {
    const stoppedAfterRecording = wasRecordingRef.current && !isRecording && !isLoading;
    wasRecordingRef.current = isRecording;

    if (!activeRef.current || !stoppedAfterRecording) return;

    void sendTranscript(transcriptRef.current).catch((err: unknown) => {
      console.error('[voice-call] failed to send transcript', err);
      setError(err instanceof Error ? err.message : t('voice.call.error.runtime'));
      setStatus('error');
    });
  }, [isLoading, isRecording, sendTranscript, t]);

  useEffect(
    () => () => {
      stop();
      cancelBrowserSpeech();
      stopNativeSession();
    },
    [stop, stopNativeSession],
  );

  const startBrowserLoop = useCallback(() => {
    if (!runtime) {
      setError(t('voice.call.unavailable.desc'));
      setStatus('error');
      return;
    }

    if (!canUseBrowserSpeechRecognition()) {
      setError(t('voice.call.error.unsupportedBrowser'));
      setStatus('error');
      return;
    }

    activeRef.current = true;
    setError(undefined);
    setStatus('listening');
    start();
  }, [runtime, start, t]);

  const startNative = useCallback(async () => {
    setStatus('connecting');
    setError(undefined);

    try {
      const session = await startOpenAIRealtimeSession(ttsSettings.voiceCall.openAIRealtimeModel);
      nativeSessionRef.current = session;
      setNativeSession(session);
      activeRef.current = true;
      setStatus('active');
    } catch (err) {
      console.error('[voice-call] OpenAI realtime session failed', err);

      if (shouldFallbackToBrowser) {
        startBrowserLoop();
        return;
      }

      setError(err instanceof Error ? err.message : t('voice.call.error.native'));
      setStatus('error');
    }
  }, [shouldFallbackToBrowser, startBrowserLoop, t, ttsSettings.voiceCall.openAIRealtimeModel]);

  const handleStart = useCallback(() => {
    if (canTryNative) {
      void startNative();
      return;
    }

    if (ttsSettings.voiceCall.mode === 'provider' && nativeProvider !== 'openai') {
      setError(t('voice.call.error.providerUnavailable'));
      setStatus('error');
      return;
    }

    startBrowserLoop();
  }, [canTryNative, nativeProvider, startBrowserLoop, startNative, t, ttsSettings.voiceCall.mode]);

  const handleEnd = useCallback(() => {
    activeRef.current = false;
    stop();
    cancelBrowserSpeech();
    stopNativeSession();
    runtime?.stop?.();
    setStatus('idle');
  }, [runtime, stop, stopNativeSession]);

  const handleMute = useCallback(() => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    nativeSessionRef.current?.setMuted(nextMuted);
  }, [muted]);

  const modeLabel = t(`voice.call.mode.${ttsSettings.voiceCall.mode}`);
  const providerLabel = nativeProvider
    ? t(`voice.call.provider.${nativeProvider}`)
    : t('voice.call.provider.browser');

  return (
    <Flexbox className={styles.panel} gap={16}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Tag>{modeLabel}</Tag>
          <Tag>{providerLabel}</Tag>
        </Flexbox>
        <Text type={'secondary'}>{t(statusI18nKey[status])}</Text>
      </Flexbox>
      <VoiceWave active={status !== 'idle' && status !== 'error'} />
      {error && <Alert showIcon message={error} type={'error'} />}
      <Flexbox className={styles.transcript} gap={8}>
        <Text strong>{t('voice.call.transcript.user')}</Text>
        <Text>{transcript || t('voice.call.transcript.empty')}</Text>
        {assistantText && (
          <>
            <Text strong>{t('voice.call.transcript.assistant')}</Text>
            <Text>{assistantText}</Text>
          </>
        )}
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button icon={muted ? <MicOff size={16} /> : <Mic size={16} />} onClick={handleMute}>
          {muted ? t('voice.call.unmute') : t('voice.call.mute')}
        </Button>
        {status === 'idle' || status === 'error' ? (
          <Button type={'primary'} onClick={handleStart}>
            {t('voice.call.start')}
          </Button>
        ) : (
          <Button danger icon={<PhoneOff size={16} />} onClick={handleEnd}>
            {t('voice.call.end')}
          </Button>
        )}
        <Button onClick={onClose}>{t('close', { ns: 'common' })}</Button>
      </Flexbox>
      {isRecording && (
        <Text type={'secondary'}>
          {formattedTime || (time > 0 ? `${time}s` : t('voice.call.status.listening'))}
        </Text>
      )}
      {nativeSession && <Text type={'secondary'}>{t('voice.call.nativeOpenAI.notice')}</Text>}
    </Flexbox>
  );
});

VoiceCallPanel.displayName = 'VoiceCallPanel';

const VoiceCallButton = memo(() => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const runtime = useChatInputStore((s) => s.voiceConversationRuntime);
  const { voiceCall } = useUserStore(settingsSelectors.currentTTS, isEqual);
  const { enableSTT } = useServerConfigStore(featureFlagsSelectors);
  const agentId = useAgentId();
  const currentProvider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
  );

  if (!enableSTT || !voiceCall.enabled) return null;

  const disabled = !runtime;

  return (
    <>
      <CircularVoiceAction
        active={open}
        desc={disabled ? t('voice.call.unavailable.title') : t('voice.call.action')}
        disabled={disabled}
        icon={AudioWaveform}
        onClick={() => setOpen(true)}
      />
      <Modal
        centered
        footer={null}
        open={open}
        title={t('voice.call.title')}
        width={520}
        onCancel={() => setOpen(false)}
      >
        <VoiceCallPanel
          currentProvider={currentProvider}
          runtime={runtime}
          onClose={() => setOpen(false)}
        />
      </Modal>
    </>
  );
});

VoiceCallButton.displayName = 'VoiceCallButton';

export default VoiceCallButton;
