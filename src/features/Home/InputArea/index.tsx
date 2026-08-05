import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useUploadFiles } from '@/components/DragUploadZone';
import { useHomeDailyBrief } from '@/hooks/useHomeDailyBrief';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import type { HomeMode } from '../types';
import { HOME_INPUT_RESERVED_HEIGHT } from './constants';
import { EditorSlot } from './EditorSlot';
import { stripMarkdownLinks } from './hintFormat';
import InputDragUpload from './InputDragUpload';
import MessengerBanner, { MESSENGER_BANNER_ID } from './MessengerBanner';
import { useSend } from './useSend';

const styles = createStaticStyles(({ css }) => ({
  inputSlot: css`
    width: 100%;
    min-height: ${HOME_INPUT_RESERVED_HEIGHT}px;
  `,
}));

interface InputAreaProps {
  inputValue: string;
  mode: HomeMode;
  onInputValueChange: (value: string) => void;
  onModeChange: (mode: HomeMode) => void;
}

const InputArea = ({ inputValue, mode, onInputValueChange, onModeChange }: InputAreaProps) => {
  const { t } = useTranslation('home');
  const { loading, send, agentId } = useSend(mode);
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

  const showMessengerBanner = mode === 'chat' && isStatusInit && !isMessengerBannerDismissed;

  // Get agent's model info for vision support check. Falls back to an empty
  // id while the agent id resolves; the selectors return DEFAULT_MODEL /
  // DEFAULT_PROVIDER for unknown ids.
  const resolvedAgentId = agentId ?? '';
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(resolvedAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(resolvedAgentId)(s),
  );
  const { handleUploadFiles } = useUploadFiles({ agentId: resolvedAgentId, model, provider });

  // Daily-generated input hint paired with the fixed Home greeting.
  const { currentPair } = useHomeDailyBrief();
  const dailyHint = currentPair?.hint ? stripMarkdownLinks(currentPair.hint) : undefined;
  const placeholder =
    mode === 'chat'
      ? dailyHint || t('dashboard.placeholder.chat')
      : t(`dashboard.placeholder.${mode}`);

  const editorSlot = (
    <div className={styles.inputSlot}>
      <EditorSlot
        agentId={agentId}
        initialValue={inputValue}
        isAgentConfigLoading={isAgentConfigLoading}
        loading={loading}
        mode={mode}
        placeholder={placeholder}
        send={send}
        onModeChange={onModeChange}
        onValueChange={onInputValueChange}
      />
    </div>
  );

  return (
    <Flexbox>
      <Flexbox
        ref={chatInputRef}
        style={{ paddingBottom: showMessengerBanner ? 32 : 0, position: 'relative' }}
      >
        {showMessengerBanner && <MessengerBanner />}
        {mode === 'chat' ? (
          <InputDragUpload
            radius={20}
            style={{ position: 'relative', zIndex: 1 }}
            onUploadFiles={handleUploadFiles}
          >
            {editorSlot}
          </InputDragUpload>
        ) : (
          editorSlot
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default InputArea;
