import { Flexbox } from '@lobehub/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import { useHomeDailyBrief } from '@/hooks/useHomeDailyBrief';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { builtinAgentSelectors } from '@/store/agent/selectors/builtinAgentSelectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import BotIntegrationBanner, { BOT_INTEGRATION_BANNER_ID } from './BotIntegrationBanner';
import { stripMarkdownLinks } from './hintFormat';
import SkillInstallBanner, { SKILL_INSTALL_BANNER_ID } from './SkillInstallBanner';
import StarterList from './StarterList';
import { useSend } from './useSend';

const leftActions: ActionKeys[] = ['model', 'search', 'fileUpload', 'tools'];

type BannerKind = 'skill' | 'botIntegration';

const InputArea = () => {
  const { loading, send, agentId } = useSend();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const isKlavisEnabled = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const isSkillBannerDismissed = useGlobalStore(
    systemStatusSelectors.isBannerDismissed(SKILL_INSTALL_BANNER_ID),
  );
  const isBotIntegrationBannerDismissed = useGlobalStore(
    systemStatusSelectors.isBannerDismissed(BOT_INTEGRATION_BANNER_ID),
  );
  const chatInputRef = useRef<HTMLDivElement>(null);

  // Wait for both stores to finish hydrating before drawing — server config
  // (skill flags) and the agent store (inboxAgentId) hydrate at different
  // times, and picking too early biases the draw toward whichever arrived
  // first. After picking, dismissing the active banner only hides it for
  // this mount — re-mounting re-rolls from the still-undismissed pool.
  const [activeBanner, setActiveBanner] = useState<BannerKind | null>(null);
  const hasPickedRef = useRef(false);

  useEffect(() => {
    if (hasPickedRef.current) return;
    if (!serverConfigInit || !inboxAgentId) return;

    const candidates: BannerKind[] = [];
    if ((isLobehubSkillEnabled || isKlavisEnabled) && !isSkillBannerDismissed) {
      candidates.push('skill');
    }
    if (!isBotIntegrationBannerDismissed) candidates.push('botIntegration');
    if (candidates.length === 0) return;

    hasPickedRef.current = true;
    setActiveBanner(candidates[Math.floor(Math.random() * candidates.length)]);
  }, [
    inboxAgentId,
    isBotIntegrationBannerDismissed,
    isKlavisEnabled,
    isLobehubSkillEnabled,
    isSkillBannerDismissed,
    serverConfigInit,
  ]);

  const isActiveBannerDismissed =
    (activeBanner === 'skill' && isSkillBannerDismissed) ||
    (activeBanner === 'botIntegration' && isBotIntegrationBannerDismissed);
  const visibleBanner = isActiveBannerDismissed ? null : activeBanner;

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

  // Daily-generated input hint paired with the home WelcomeText. The hint
  // tracks whichever pair the WelcomeText typewriter is currently showing,
  // via the shared rotating index inside `useHomeDailyBrief`.
  const { currentPair } = useHomeDailyBrief();
  const dailyHint = currentPair?.hint ? stripMarkdownLinks(currentPair.hint) : undefined;

  return (
    <Flexbox gap={16} style={{ marginBottom: 16 }}>
      <Flexbox
        ref={chatInputRef}
        style={{ paddingBottom: visibleBanner ? 32 : 0, position: 'relative' }}
      >
        {visibleBanner === 'skill' && <SkillInstallBanner />}
        {visibleBanner === 'botIntegration' && <BotIntegrationBanner />}
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
              placeholder={dailyHint}
              showRuntimeConfig={false}
            />
          </ChatInputProvider>
        </DragUploadZone>
      </Flexbox>

      <StarterList />
    </Flexbox>
  );
};

export default InputArea;
