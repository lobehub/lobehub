import { Flexbox } from '@lobehub/ui';
import { AnimatePresence, m as motion } from 'motion/react';
import { useMemo } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useHomeStore } from '@/store/home';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import CommunityRecommend from '../CommunityRecommend';
import SuggestQuestions from '../SuggestQuestions';
import ModeTag from './ModeTag';
import SkillInstallBanner from './SkillInstallBanner';
import StarterList from './StarterList';
import { useSend } from './useSend';

const leftActions: ActionKeys[] = ['model', 'search', 'fileUpload', 'tools'];

const InputArea = () => {
  const { loading, send, inboxAgentId } = useSend();
  const inputActiveMode = useHomeStore((s) => s.inputActiveMode);
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const isKlavisEnabled = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const showSkillBanner = isLobehubSkillEnabled || isKlavisEnabled;

  // Get agent's model info for vision support check
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(inboxAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(inboxAgentId)(s),
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

  const showSuggestQuestions =
    inputActiveMode && ['agent', 'group', 'write'].includes(inputActiveMode);

  const extraActionItems = useMemo(
    () =>
      inputActiveMode
        ? [
            {
              children: <ModeTag />,
              key: 'mode-tag',
            },
          ]
        : [],
    [inputActiveMode],
  );

  return (
    <Flexbox gap={16} style={{ marginBottom: 16 }}>
      <Flexbox style={{ paddingBottom: showSkillBanner ? 32 : 0, position: 'relative' }}>
        {showSkillBanner && <SkillInstallBanner />}
        <DragUploadZone
          style={{ position: 'relative', zIndex: 1 }}
          onUploadFiles={handleUploadFiles}
        >
          <ChatInputProvider
            agentId={inboxAgentId}
            allowExpand={false}
            leftActions={leftActions}
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
              extraActionItems={extraActionItems}
              inputContainerProps={inputContainerProps}
            />
          </ChatInputProvider>
        </DragUploadZone>
      </Flexbox>

      {/* Keep StarterList mounted to prevent useInitBuiltinAgent hooks from re-running */}
      <div style={{ display: showSuggestQuestions ? 'none' : undefined }}>
        <StarterList />
      </div>
      <AnimatePresence mode="popLayout">
        {showSuggestQuestions && (
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            key={inputActiveMode}
            transition={{
              duration: 0.2,
              ease: [0.4, 0, 0.2, 1],
            }}
          >
            <Flexbox gap={24}>
              <SuggestQuestions mode={inputActiveMode} />
              <CommunityRecommend mode={inputActiveMode} />
            </Flexbox>
          </motion.div>
        )}
      </AnimatePresence>
    </Flexbox>
  );
};

export default InputArea;
