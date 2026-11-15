'use client';

import { conversationConfigSchema } from '@lobechat/livekit-bridge';
import { Flexbox, Popover } from '@lobehub/ui';
import { Phone, PhoneOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { ChatInputAction } from '@/features/ChatInput/ActionBar/components/ChatInputAction';
import { useMediaUploadAbility } from '@/hooks/useMediaUploadAbility';
import { handleConversationSpeech } from '@/services/conversation';
import { livekitService } from '@/services/livekit';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { useConversationStore, useConversationStoreApi } from '../store';
import { CallPanel } from './CallPanel';
import { VoiceCallClient } from './client';
import { getVoiceReply } from './reply';
import { uploadTalkFrame } from './uploadFrame';

export const VoiceCall = () => {
  const preferences = useUserStore(
    (s) => settingsSelectors.currentSettings(s).general?.conversation,
  );
  const configured = useUserStore((s) =>
    Boolean(settingsSelectors.currentSettings(s).keyVaults?.livekit),
  );
  const config = conversationConfigSchema.parse(preferences ?? {});
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const context = useConversationStore((s) => s.context);
  const writable = useConversationStore((s) => s.composerTarget.writable);
  const store = useConversationStoreApi();
  const { t } = useTranslation('chat');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'working'>('idle');
  const [video, setVideo] = useState(false);
  const [activeClient, setActiveClient] = useState<VoiceCallClient | undefined>(undefined);
  const model = useAgentStore(agentByIdSelectors.getAgentModelById(context.agentId));
  const provider = useAgentStore(agentByIdSelectors.getAgentModelProviderById(context.agentId));
  const { canUploadImage } = useMediaUploadAbility(model, provider, context.agentId);
  const [error, setError] = useState(false);
  const call = useRef<{ client: VoiceCallClient; roomName?: string } | undefined>(undefined);

  const end = async () => {
    const current = call.current;
    call.current = undefined;
    setActiveClient(undefined);
    setStatus('idle');
    setVideo(false);
    if (!current) return;
    await current.client.close().catch(() => {});
    if (current.roomName) await livekitService.endSession(current.roomName).catch(() => {});
  };

  // A call belongs to one existing conversation. Navigation must release the mic.
  useEffect(
    () => () => {
      void end();
    },
    [context.agentId, context.topicId],
  );

  const start = async () => {
    if (!configured || !config.enabled || !config.tts.model) {
      navigate('/settings/conversation');
      return;
    }
    if (call.current || !context.topicId || !writable) return;
    setError(false);
    setStatus('connecting');
    const client = new VoiceCallClient({
      onDisconnected: (unexpected) => {
        setError(unexpected);
        void end();
      },
      onError: () => setError(true),
      onSpeech: handleConversationSpeech,
      onWorking: (working) => setStatus(working ? 'working' : 'connected'),
      onTurn: async (text, signal) => {
        const state = store.getState();
        if (
          !state.composerTarget.writable ||
          messageMapKey(state.context) !== messageMapKey(context)
        ) {
          throw new Error('The conversation is no longer available');
        }
        if (operationSelectors.isInputVisiblyLoadingByContext(context)(useChatStore.getState())) {
          throw new Error('Wait for the current agent turn to finish');
        }
        const frame = canUploadImage ? await client.captureFrame() : undefined;
        const files = frame ? [await uploadTalkFrame(frame, context.agentId, signal)] : undefined;
        signal.throwIfAborted();
        const result = await useChatStore.getState().sendMessage({
          context,
          inputEditor: null,
          message: text,
          files,
          preserveComposer: true,
          signal,
        });
        signal.throwIfAborted();
        if (!result) throw new Error('The voice turn was not accepted');
        const messages = useChatStore.getState().dbMessagesMap[messageMapKey(context)] ?? [];
        return getVoiceReply(messages, result.userMessageId);
      },
    });
    const current = { client, roomName: undefined as string | undefined };
    call.current = current;
    setActiveClient(client);
    try {
      const session = await livekitService.createSession();
      current.roomName = session.roomName;
      if (call.current !== current) {
        await livekitService.endSession(session.roomName);
        return;
      }
      setVideo(session.config.mode === 'video' && canUploadImage);
      await client.connect(session.serverUrl, session.token);
      if (call.current === current) setStatus('connected');
    } catch {
      if (call.current === current) {
        setError(true);
        await end();
      }
    }
  };

  useEffect(() => {
    if (search.get('conversation') !== 'start' || !context.topicId || !writable) return;
    const next = new URLSearchParams(search);
    next.delete('conversation');
    setSearch(next, { replace: true });
    void start();
  }, [search, context.topicId, writable]);
  const active = status !== 'idle';

  return (
    <Flexbox horizontal align="center" gap={4}>
      <Popover
        content={activeClient ? <CallPanel room={activeClient.room} video={video} /> : undefined}
        open={active}
        onOpenChange={(open) => {
          if (!open && active) void end();
        }}
      >
        <ChatInputAction
          aria-label={active ? t('voiceCall.end') : t('voiceCall.start')}
          disabled={!active && (!context.topicId || !writable)}
          icon={active ? PhoneOff : Phone}
          title={
            !context.topicId
              ? t('voiceCall.needsConversation')
              : active
                ? t('voiceCall.end')
                : t('voiceCall.start')
          }
          onClick={() => {
            void (active ? end() : start());
          }}
        />
      </Popover>
      {error && <span role="alert">{t('voiceCall.error')}</span>}
    </Flexbox>
  );
};
