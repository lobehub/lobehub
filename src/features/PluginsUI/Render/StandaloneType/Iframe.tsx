import { type PluginRequestPayload } from '@lobehub/chat-plugin-sdk';
import { Skeleton } from '@lobehub/ui';
import { memo, useRef, useState } from 'react';

import { useChatStore } from '@/store/chat';
import { dbMessageSelectors } from '@/store/chat/selectors';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import { useOnPluginReadyForInteraction } from '../utils/iframeOnReady';
import {
  useOnPluginCreateAssistantMessage,
  useOnPluginFetchMessage,
  useOnPluginFetchPluginSettings,
  useOnPluginFetchPluginState,
  useOnPluginFillContent,
  useOnPluginTriggerAIMessage,
} from '../utils/listenToPlugin';
import { useOnPluginSettingsUpdate } from '../utils/pluginSettings';
import { useOnPluginStateUpdate } from '../utils/pluginState';
import {
  sendMessageContentToPlugin,
  sendPayloadToPlugin,
  sendPluginSettingsToPlugin,
  sendPluginStateToPlugin,
} from '../utils/postMessage';

// just to simplify code a little, don't use this pattern everywhere
const getSettings = (identifier: string) =>
  pluginSelectors.getPluginSettingsById(identifier)(useToolStore.getState());
const getMessage = (id: string) => dbMessageSelectors.getDbMessageById(id)(useChatStore.getState());

interface IFrameRenderProps {
  height?: number;
  id: string;
  payload?: PluginRequestPayload;
  url: string;
  width?: number;
}

const IFrameRender = memo<IFrameRenderProps>(({ url, id, payload, width = 600, height = 300 }) => {
  const [loading, setLoading] = useState(true);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // when payload change，send content to plugin
  useOnPluginReadyForInteraction(() => {
    const iframeWin = iframeRef.current?.contentWindow;

    if (iframeWin && payload) {
      const settings = getSettings(payload.identifier);
      const message = getMessage(id);
      const state = message?.pluginState;

      sendPayloadToPlugin(iframeWin, { payload, settings, state });
    }
  }, [payload]);

  // when plugin wants to get message content, send it to plugin
  useOnPluginFetchMessage(() => {
    const iframeWin = iframeRef.current?.contentWindow;

    if (iframeWin) {
      const message = dbMessageSelectors.getDbMessageById(id)(useChatStore.getState());
      if (!message) return;
      const props = { content: '' };

      try {
        props.content = JSON.parse(message.content || '{}');
      } catch {
        props.content = message.content || '';
      }

      sendMessageContentToPlugin(iframeWin, props);
    }
  }, []);

  // when plugin try to send back message, we should fill it to the message content
  const fillPluginContent = useChatStore((s) => s.fillPluginMessageContent);
  useOnPluginFillContent((content, triggerAiMessage) => {
    fillPluginContent(id, content, triggerAiMessage);
  });

  // when plugin wants to get plugin state, send it to plugin
  useOnPluginFetchPluginState((key) => {
    const iframeWin = iframeRef.current?.contentWindow;

    if (iframeWin) {
      const message = getMessage(id);
      if (!message) return;

      sendPluginStateToPlugin(iframeWin, key, message.pluginState?.[key]);
    }
  });

  // when plugin update state, we should update it to the message pluginState key
  const optimisticUpdatePluginState = useChatStore((s) => s.optimisticUpdatePluginState);
  useOnPluginStateUpdate((key, value) => {
    optimisticUpdatePluginState(id, { [key]: value });
  });

  // when plugin wants to get plugin settings, send it to plugin
  useOnPluginFetchPluginSettings(() => {
    const iframeWin = iframeRef.current?.contentWindow;

    if (iframeWin) {
      if (!payload?.identifier) return;

      const settings = getSettings(payload.identifier);

      sendPluginSettingsToPlugin(iframeWin, settings);
    }
  });

  // when plugin update settings, we should update it to the plugin settings
  const updatePluginSettings = useToolStore((s) => s.updatePluginSettings);
  useOnPluginSettingsUpdate((value) => {
    if (!payload?.identifier) return;

    updatePluginSettings(payload?.identifier, value);
  });

  // when plugin want to trigger AI message
  const triggerAIMessage = useChatStore((s) => s.triggerAIMessage);
  useOnPluginTriggerAIMessage((messageId) => {
    // we need to know which message to trigger
    if (messageId !== id) return;

    triggerAIMessage({ parentId: id });
  });

  // when plugin want to create an assistant message
  const createAssistantMessage = useChatStore((s) => s.createAssistantMessageByPlugin);
  useOnPluginCreateAssistantMessage((content) => {
    createAssistantMessage(content, id);
  });

  return (
    <>
      {loading && <Skeleton active style={{ maxWidth: '100%', width }} />}
      <iframe
        // @ts-ignore
        allowtransparency="true"
        height={height}
        hidden={loading}
        ref={iframeRef}
        src={url}
        width={width}
        style={{
          border: 0,
          // iframe 在 color-scheme:dark 模式下无法透明
          // refs: https://www.jianshu.com/p/bc5a37bb6a7b
          colorScheme: 'light',
          maxWidth: '100%',
        }}
        onLoad={() => {
          setLoading(false);
        }}
      />
    </>
  );
});
export default IFrameRender;
