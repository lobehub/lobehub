import { Flexbox } from '@lobehub/ui';
import { useMemo, useRef } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { builtinAgentSelectors } from '@/store/agent/selectors/builtinAgentSelectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import SuggestQuestions from '../SuggestQuestions';
import BotIntegrationBanner, { BOT_INTEGRATION_BANNER_ID } from './BotIntegrationBanner';
import StarterList from './StarterList';
import { useSend } from './useSend';

const leftActions: ActionKeys[] = ['model', 'search', 'fileUpload', 'tools'];

const InputArea = () => {
  const { loading, send, agentId } = useSend();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isBotIntegrationBannerDismissed = useGlobalStore(
    systemStatusSelectors.isBannerDismissed(BOT_INTEGRATION_BANNER_ID),
  );
  const showBotIntegrationBanner = !!inboxAgentId && !isBotIntegrationBannerDismissed;
  const chatInputRef = useRef<HTMLDivElement>(null);

  // Get agent's model info for vision support check. Falls back to an empty
  // id while the agent id resolves; the selectors return DEFAULT_MODEL /
  // DEFAULT_PROVIDER for unknown ids.
  const resolvedAgentId = agentId ?? '';
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(resolvedAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(resolvedAgentId)(s),
  );
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  // A slot to insert content above the chat input
  // Override some default behavior of the chat input
  const inputContainerProps = useMemo(
    () => ({
      minHeight: 88,
      resize: false,
      style: {
        borderRadius: 20,
        boxShadow: '0 12px 32px rgba(0,0,0,.04)',
      },
    }),
    [],
  );

  const { enableAgentTask } = useServerConfigStore(featureFlagsSelectors);
  // Whitelist users get DailyBrief + an upcoming auto-generated module instead.
  const showSuggestQuestions = !enableAgentTask;

  return (
    <Flexbox gap={16} style={{ marginBottom: 16 }}>
      <Flexbox
        ref={chatInputRef}
        style={{ paddingBottom: showBotIntegrationBanner ? 32 : 0, position: 'relative' }}
      >
        {showBotIntegrationBanner && <BotIntegrationBanner />}
        <DragUploadZone
          style={{ position: 'relative', zIndex: 1 }}
          onUploadFiles={handleUploadFiles}
        >
          <ChatInputProvider
            agentId={agentId}
            allowExpand={false}
            leftActions={leftActions}
            slashPlacement="bottom"
            chatInputEditorRef={(instance) => {
              if (!instance) return;
              useChatStore.setState({ mainInputEditor: instance });
            }}
            sendButtonProps={{
              disabled: loading,
              generating: loading,
              onStop: () => {},
              shape: 'round',
            }}
            onSend={send}
            onMarkdownContentChange={(content) => {
              useChatStore.setState({ inputMessage: content });
            }}
          >
            <DesktopChatInput
              dropdownPlacement="bottomLeft"
              inputContainerProps={inputContainerProps}
              showRuntimeConfig={false}
            />
          </ChatInputProvider>
        </DragUploadZone>
      </Flexbox>

      <StarterList />
      {showSuggestQuestions && (
        <Flexbox style={{ marginTop: 24 }}>
          <SuggestQuestions />
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default InputArea;
