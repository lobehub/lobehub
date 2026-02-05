import { Block, Button, Flexbox, Form, MaterialFileTypeIcon, Select } from '@lobehub/ui';
import { App } from 'antd';
import { memo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import RepoIcon from '@/components/LibIcon';
import { useKnowledgeBaseStore } from '@/store/library';

interface CreateFormProps {
  fileIds: string[];
  knowledgeBaseId?: string;
  onClose?: () => void;
}

const SelectForm = memo<CreateFormProps>(({ onClose, knowledgeBaseId, fileIds }) => {
  const { t } = useTranslation('knowledgeBase');
  const [loading, setLoading] = useState(false);

  const { message } = App.useApp();
  const [useFetchKnowledgeBaseList, addFilesToKnowledgeBase] = useKnowledgeBaseStore((s) => [
    s.useFetchKnowledgeBaseList,
    s.addFilesToKnowledgeBase,
  ]);
  const { data, isLoading } = useFetchKnowledgeBaseList();
  const onFinish = async (values: { id: string }) => {
    setLoading(true);

    try {
      await addFilesToKnowledgeBase(values.id, fileIds);
      setLoading(false);
      message.success({
        content: (
          <Trans
            i18nKey={'addToKnowledgeBase.addSuccess'}
            ns={'knowledgeBase'}
            components={[
              <span key="0" />,
              <Link key="1" to={`/knowledge/library/${values.id}`} />,
            ]}
          />
        ),
      });

      onClose?.();
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  return (
    <Form
      gap={16}
      itemsType={'flat'}
      layout={'vertical'}
      footer={
        <Button block htmlType={'submit'} loading={loading} type={'primary'}>
          {t('addToKnowledgeBase.confirm')}
        </Button>
      }
      items={[
        {
          children: (
            <Block horizontal align={'center'} gap={8} padding={16} variant={'filled'}>
              <MaterialFileTypeIcon filename={''} size={32} />
              {t('addToKnowledgeBase.totalFiles', { count: fileIds.length })}
            </Block>
          ),
          noStyle: true,
        },
        {
          children: (
            <Select
              autoFocus
              loading={isLoading}
              placeholder={t('addToKnowledgeBase.id.placeholder')}
              options={(data || [])
                .filter((item) => item.id !== knowledgeBaseId)
                .map((item) => ({
                  label: (
                    <Flexbox horizontal gap={8}>
                      <RepoIcon />
                      {item.name}
                    </Flexbox>
                  ),
                  value: item.id,
                }))}
            />
          ),
          label: t('addToKnowledgeBase.id.title'),
          name: 'id',
          rules: [{ message: t('addToKnowledgeBase.id.required'), required: true }],
        },
      ]}
      onFinish={onFinish}
    />
  );
});

export default SelectForm;
