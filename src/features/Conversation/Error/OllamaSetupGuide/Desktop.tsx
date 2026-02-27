import { Ollama } from '@lobehub/icons';
import { Button } from '@lobehub/ui';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation/store';

import BaseErrorForm from '../BaseErrorForm';

// TODO: Optimize the Ollama setup flow - in isDesktop mode, end-to-end detection can be done directly
const OllamaDesktopSetupGuide = memo<{ id?: string }>(({ id }) => {
  const { t } = useTranslation('components');

  const [delAndRegenerateMessage] = useConversationStore((s) => [s.delAndRegenerateMessage]);

  return (
    <BaseErrorForm
      avatar={<Ollama.Avatar shape={'square'} size={40} />}
      title={t('OllamaSetupGuide.install.title')}
      action={
        <Button
          type={'primary'}
          onClick={() => {
            if (id) delAndRegenerateMessage(id);
          }}
        >
          {t('OllamaSetupGuide.action.start')}
        </Button>
      }
      desc={
        <Trans
          components={[<span key="0" />, <a href={'https://ollama.com/download'} key="1" rel="noreferrer" target="_blank" />]}
          i18nKey={'OllamaSetupGuide.install.description'}
          ns={'components'}
        />
      }
    />
  );
});

export default OllamaDesktopSetupGuide;
