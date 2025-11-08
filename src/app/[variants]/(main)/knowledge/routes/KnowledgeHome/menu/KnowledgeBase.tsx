import { CaretDownFilled, CaretRightOutlined } from '@ant-design/icons';
import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { useNavigate } from 'react-router-dom';

import { useCreateNewModal } from '@/features/KnowledgeBaseModal';

import KnowledgeBaseList from '../../../components/KnowledgeBaseList';

const useStyles = createStyles(({ css, token }) => ({
  header: css`
    color: ${token.colorTextDescription};
  `,
}));

const KnowledgeBase = () => {
  const { t } = useTranslation('file');
  const { styles } = useStyles();
  const navigate = useNavigate();

  const [showList, setShowList] = useState(true);

  const { open } = useCreateNewModal();

  const handleCreate = () => {
    open({
      onSuccess: (id) => {
        navigate(`/bases/${id}`);
      },
    });
  };

  return (
    <Flexbox flex={1} gap={8}>
      <Flexbox
        align={'center'}
        className={styles.header}
        horizontal
        justify={'space-between'}
        paddingInline={'16px 12px'}
      >
        <Flexbox align={'center'} gap={8} horizontal>
          <ActionIcon
            icon={(showList ? CaretDownFilled : CaretRightOutlined) as any}
            onClick={() => {
              setShowList(!showList);
            }}
            size={'small'}
          />
          <div style={{ lineHeight: '14px' }}>{t('knowledgeBase.title')}</div>
        </Flexbox>
        <ActionIcon
          icon={PlusIcon}
          onClick={handleCreate}
          size={'small'}
          title={t('knowledgeBase.new')}
        />
      </Flexbox>

      {showList && <KnowledgeBaseList />}
    </Flexbox>
  );
};

export default KnowledgeBase;
