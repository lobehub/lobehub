import { Icon } from '@lobehub/ui';
import { LibraryBig } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { createModal } from '@/components/FunctionModal';

import CreateForm from './CreateForm';

const Title = () => {
  const { t } = useTranslation('knowledgeBase');
  return (
    <Flexbox gap={8} horizontal>
      <Icon icon={LibraryBig} />
      {t('createNew.title')}
    </Flexbox>
  );
};

// eslint-disable-next-line unused-imports/no-unused-vars
export const useCreateNewModal = createModal<{ onSuccess?: (id: string) => void }>(
  (instance, props) => {
    return {
      content: (
        <Flexbox paddingInline={16} style={{ paddingBottom: 16 }}>
          <CreateForm
            onClose={() => {
              instance.current?.destroy();
            }}
            onSuccess={props?.onSuccess}
          />
        </Flexbox>
      ),
      focusTriggerAfterClose: true,
      footer: false,
      title: <Title />,
    };
  },
);
