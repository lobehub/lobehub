import { ActionIcon, Button, Flexbox } from '@lobehub/ui';
import { LucideNotepadText, PlusSquareIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors, operationSelectors } from '@/store/chat/selectors';

const Footer = () => {
  const [messageId, isAgentRuntimeRunning, triggerAIMessage, saveSearchResult] = useChatStore(
    (s) => [
      chatPortalSelectors.toolMessageId(s),
      operationSelectors.isAgentRuntimeRunning(s),
      s.triggerAIMessage,
      s.saveSearchResult,
    ],
  );

  const { t } = useTranslation('tool');

  return (
    <Flexbox horizontal gap={8} paddingBlock={12} paddingInline={12}>
      <Button
        icon={LucideNotepadText}
        loading={isAgentRuntimeRunning}
        onClick={() => {
          if (!messageId) return;

          triggerAIMessage({});
        }}
      >
        {t('search.summaryTooltip')}
      </Button>
      <ActionIcon
        icon={PlusSquareIcon}
        loading={isAgentRuntimeRunning}
        title={t('search.createNewSearch')}
        onClick={() => {
          if (!messageId) return;

          saveSearchResult(messageId);
        }}
      />
    </Flexbox>
  );
};

export default Footer;
