import { Flexbox } from '@lobehub/ui';
import { useMemo, useRef } from 'react';

import { useUploadFiles } from '@/components/DragUploadZone';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import { useHomeDailyBrief } from '@/hooks/useHomeDailyBrief';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { stripMarkdownLinks } from './hintFormat';
import InputDragUpload from './InputDragUpload';
import MessengerBanner, { MESSENGER_BANNER_ID } from './MessengerBanner';
import StarterList from './StarterList';
import { useSend } from './useSend';

const leftActions: ActionKeys[] = ['agentMode', 'plus'];
const rightActions: ActionKeys[] = ['modelLabel'];

const InputArea = () => {
  const { loading, send, agentId } = useSend();
  // Subscribe to the SWR key so `internal_refreshAgentConfig`'s `mutate(...)`
  // has a listener after toggleFile / toggleKnowledgeBase — otherwise the
  // Library submenu doesn't reflect server-side toggles. Pass `agentId`
  // explicitly so AgentSelect switches refetch too.
  useInitAgentConfig(agentId);
  // Use the "config absent from agentMap" loading shape (same as Memory /
  // Search / History) instead of SWR's `isLoading`, which would flash on
  // every mount-time revalidation even when inbox data is already cached.
  const isAgentConfigLoading = useAgentStore((s) =>
    agentByIdSelectors.isAgentConfigLoadingById(agentId ?? '')(s),
  );
  const isMessengerBannerDismissed = useGlobalStore(
    systemStatusSelectors.isBannerDismissed(MESSENGER_BANNER_ID),
  );
  // Wait for the persisted status to hydrate so users who already dismissed
  // the banner never see it flash on mount.
  const isStatusInit = useGlobalStore(systemStatusSelectors.isStatusInit);
  const chatInputRef = useRef<HTMLDivElement>(null);

  const showMessengerBanner = isStatusInit && !isMessengerBannerDismissed;

  // Get agent's model info for vision support check. Falls back to an empty
  // id while the agent id resolves; the selectors return DEFAULT_MODEL /
  // DEFAULT_PROVIDER for unknown ids.
  const resolvedAgentId = agentId ?? '';
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(resolvedAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(resolvedAgentId)(s),
  );
  const { handleUploadFiles } = useUploadFiles({ agentId: resolvedAgentId, model, provider });

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

  // Daily-generated input hint paired with the home WelcomeText. The hint
  // tracks whichever pair the WelcomeText typewriter is currently showing,
  // via the shared rotating index inside `useHomeDailyBrief`.
  const { currentPair } = useHomeDailyBrief();
  const dailyHint = currentPair?.hint ? stripMarkdownLinks(currentPair.hint) : undefined;

  return (
    <Flexbox gap={16} style={{ marginBottom: 16 }}>
      <Flexbox
        ref={chatInputRef}
        style={{ paddingBottom: showMessengerBanner ? 32 : 0, position: 'relative' }}
      >
        {showMessengerBanner && <MessengerBanner />}
        <InputDragUpload
          radius={20}
          style={{ position: 'relative', zIndex: 1 }}
          onUploadFiles={handleUploadFiles}
        >
          <ChatInputProvider
            agentId={agentId}
            allowExpand={false}
            leftActions={leftActions}
            rightActions={rightActions}
            slashPlacement="bottom"
            chatInputEditorRef={(instance) => {
              if (!instance) return;
              useChatStore.setState({ mainInputEditor: instance });
            }}
            sendButtonProps={{
              disabled: loading || isAgentConfigLoading,
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
              isConfigLoading={isAgentConfigLoading}
              placeholder={dailyHint}
              showControlBar={false}
            />
          </ChatInputProvider>
        </InputDragUpload>
      </Flexbox>

      <StarterList />
    </Flexbox>
  );
};

export default InputArea;
