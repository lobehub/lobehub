import { Button } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import OllamaModelDownloader from '@/features/OllamaModelDownloader';

import { useConversationStore } from '../../store';
import { ErrorActionContainer } from '../style';

interface InvalidOllamaModelProps {
  id: string;
  model: string;
}

const InvalidOllamaModel = memo<InvalidOllamaModelProps>(({ id, model }) => {
  const { t } = useTranslation('error');

  const [delAndRegenerateMessage, deleteMessage] = useConversationStore((s) => [
    s.delAndRegenerateMessage,
    s.deleteMessage,
  ]);
  return (
    <ErrorActionContainer>
      <OllamaModelDownloader
        model={model}
        extraAction={
          <Button
            onClick={() => {
              deleteMessage(id);
            }}
          >
            {t('unlock.closeMessage')}
          </Button>
        }
        onSuccessDownload={() => {
          delAndRegenerateMessage(id);
        }}
      />
    </ErrorActionContainer>
  );
});

export default InvalidOllamaModel;
