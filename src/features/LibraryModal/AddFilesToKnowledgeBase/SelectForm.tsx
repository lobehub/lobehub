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
            components={[
              <span key="0" />,
              <Link key="1" to={`/knowledge/library/${values.id}`} />,
            ]}
            i18nKey={'addToKnowledgeBase.addSuccess'}
            ns={'knowledgeBase'}
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
      footer={
        <Button block htmlType={'submit'} loading={loading} type={'primary'}>
          {t('addToKnowledgeBase.confirm')}
        </Button>
      }
      gap={16}
      items={[
        {
          children: (
            <Block align={'center'} gap={8} horizontal padding={16} variant={'filled'}>
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
              options={(data || [])
                .filter((item) => item.id !== knowledgeBaseId)
                .map((item) => ({
                  label: (
                    <Flexbox gap={8} horizontal>
                      <RepoIcon />
                      {item.name}
                    </Flexbox>
                  ),
                  value: item.id,
                }))}
              placeholder={t('addToKnowledgeBase.id.placeholder')}
            />
          ),
          label: t('addToKnowledgeBase.id.title'),
          name: 'id',
          rules: [{ message: t('addToKnowledgeBase.id.required'), required: true }],
        },
      ]}
      itemsType={'flat'}
      layout={'vertical'}
      onFinish={onFinish}
    />
  );
});

export default SelectForm;
