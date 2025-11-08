import { Block, Button, Form, MaterialFileTypeIcon, Select } from '@lobehub/ui';
import { App } from 'antd';
import Link from 'next/link';
import { memo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import RepoIcon from '@/components/RepoIcon';
import { useKnowledgeBaseStore } from '@/store/knowledgeBase';

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
          <Trans i18nKey={'addToKnowledgeBase.addSuccess'} ns={'knowledgeBase'}>
            文件添加成功，<Link href={`/knowledge/bases/${values.id}`}>立即查看</Link>
          </Trans>
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
