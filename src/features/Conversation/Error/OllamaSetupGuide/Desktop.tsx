import { Ollama } from '@lobehub/icons';
import { Button } from '@lobehub/ui';
import Link from 'next/link';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation/store';

import BaseErrorForm from '../BaseErrorForm';

// TODO: 优化 Ollama setup 的流程，isDesktop 模式下可以直接做到端到端检测
const OllamaDesktopSetupGuide = memo<{ id?: string }>(({ id }) => {
  const { t } = useTranslation('components');

  const [delAndRegenerateMessage] = useConversationStore((s) => [s.delAndRegenerateMessage]);

  return (
    <BaseErrorForm
      action={
        <Button
          onClick={() => {
            if (id) delAndRegenerateMessage(id);
          }}
          type={'primary'}
        >
          {t('OllamaSetupGuide.action.start')}
        </Button>
      }
      avatar={<Ollama.Avatar shape={'square'} size={40} />}
      desc={
        <Trans
          components={[<span key="0" />, <Link href={'https://ollama.com/download'} key="1" />]}
          i18nKey={'OllamaSetupGuide.install.description'}
          ns={'components'}
        />
      }
      title={t('OllamaSetupGuide.install.title')}
    />
  );
});

export default OllamaDesktopSetupGuide;
