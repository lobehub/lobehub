'use client';

import { Input, Select, TextArea } from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import { App, Form } from 'antd';
import { cssVar } from 'antd-style';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useEvalStore } from '@/store/eval';

const toIdentifier = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, '-')
    .replaceAll(/[^\da-z-]/g, '');

export interface CreateBenchmarkContentProps {
  formId: string;
  onLoadingChange?: (loading: boolean) => void;
}

const CreateBenchmarkContent: FC<CreateBenchmarkContentProps> = ({ formId, onLoadingChange }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  const { message } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const [form] = Form.useForm();
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const createBenchmark = useEvalStore((s) => s.createBenchmark);

  const nameValue = Form.useWatch('name', form);

  useEffect(() => {
    if (!identifierTouched && nameValue) {
      form.setFieldValue('identifier', toIdentifier(nameValue));
    }
  }, [nameValue, identifierTouched, form]);

  const handleFinish = async (values: any) => {
    onLoadingChange?.(true);
    try {
      const result = await createBenchmark({
        description: values.description?.trim() || undefined,
        identifier: values.identifier.trim(),
        name: values.name.trim(),
        tags: values.tags?.length > 0 ? values.tags : undefined,
      });
      message.success(t('benchmark.create.success'));
      close();
      if (result?.id) {
        navigate(`/eval/bench/${result.id}`);
      }
    } catch {
      message.error(t('benchmark.create.error'));
    } finally {
      onLoadingChange?.(false);
    }
  };

  return (
    <Form form={form} layout="vertical" name={formId} onFinish={handleFinish}>
      <Form.Item
        label={t('benchmark.create.name.label')}
        name="name"
        rules={[{ message: t('benchmark.create.nameRequired'), required: true }]}
      >
        <Input autoFocus placeholder={t('benchmark.create.name.placeholder')} />
      </Form.Item>

      <Form.Item
        label={t('benchmark.create.identifier.label')}
        name="identifier"
        rules={[{ message: t('benchmark.create.identifierRequired'), required: true }]}
      >
        <Input
          placeholder={t('benchmark.create.identifier.placeholder')}
          style={{ fontFamily: cssVar.fontFamilyCode }}
          onChange={() => setIdentifierTouched(true)}
        />
      </Form.Item>

      <Form.Item label={t('benchmark.create.description.label')} name="description">
        <TextArea placeholder={t('benchmark.create.description.placeholder')} rows={3} />
      </Form.Item>

      <Form.Item label={t('benchmark.create.tags.label')} name="tags" style={{ marginBottom: 0 }}>
        <Select
          mode="tags"
          open={false}
          placeholder={t('benchmark.create.tags.placeholder')}
          style={{ width: '100%' }}
          tokenSeparators={[',', '，', ' ']}
        />
      </Form.Item>
    </Form>
  );
};

export default CreateBenchmarkContent;
