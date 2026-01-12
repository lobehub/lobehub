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
    cursor: pointer;
    border-radius: ${token.borderRadius}px;
    color: ${token.colorTextSecondary};
    transition: background-color 0.2s;

    &:hover {
      background-color: ${token.colorFillTertiary};
    }
  `,
}));

// TODO: Rename to Collection
const Collection = () => {
  const { t } = useTranslation('file');
  const { styles } = useStyles();
  const navigate = useNavigate();

  const [showList, setShowList] = useState(true);

  const { open } = useCreateNewModal();

  const handleCreate = () => {
    open({
      onSuccess: (id) => {
        navigate(`/knowledge/bases/${id}`);
      },
    });
  };

  return (
    <Flexbox flex={1} gap={8} paddingInline={8}>
      <Flexbox
        align={'center'}
        className={styles.header}
        horizontal
        justify={'space-between'}
        paddingBlock={6}
        paddingInline={8}
      >
        <Flexbox align={'center'} gap={8} horizontal>
          <ActionIcon
            icon={showList ? CaretDownFilled : CaretRightOutlined}
            onClick={() => {
              setShowList(!showList);
            }}
            size={'small'}
          />
          <div style={{ flex: 1, lineHeight: '14px' }}>{t('knowledgeBase.title')}</div>
        </Flexbox>
        <ActionIcon
          icon={PlusIcon}
          onClick={handleCreate}
          size={'small'}
          title={t('knowledgeBase.new')}
        />
      </Flexbox>

      {showList && (
        <Flexbox flex={1}>
          <KnowledgeBaseList />
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default Collection;
