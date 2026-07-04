'use client';

import { Input, Select, TextArea } from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import { App, Form } from 'antd';
import { cssVar } from 'antd-style';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEvalStore } from '@/store/eval';

const toIdentifier = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, '-')
    .replaceAll(/[^\da-z-]/g, '');

export interface BenchmarkEditContentProps {
  benchmark: {
    description?: string;
    id: string;
    identifier: string;
    metadata?: any;
    name: string;
    tags?: string[];
  };
  formId: string;
  onLoadingChange?: (loading: boolean) => void;
  onSuccess?: () => void;
}

const BenchmarkEditContent: FC<BenchmarkEditContentProps> = ({
  benchmark,
  formId,
  onLoadingChange,
  onSuccess,
}) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const updateBenchmark = useEvalStore((s) => s.updateBenchmark);

  const nameValue = Form.useWatch('name', form);

  useEffect(() => {
    if (benchmark) {
      form.setFieldsValue({
        description: benchmark.description || '',
        identifier: benchmark.identifier,
        name: benchmark.name,
        tags: benchmark.tags || [],
      });
    }
  }, [benchmark, form]);

  useEffect(() => {
    if (!identifierTouched && nameValue) {
      form.setFieldValue('identifier', toIdentifier(nameValue));
    }
  }, [nameValue, identifierTouched, form]);

  const handleFinish = async (values: any) => {
    onLoadingChange?.(true);
    try {
      await updateBenchmark({
        description: values.description?.trim() || undefined,
        id: benchmark.id,
        identifier: values.identifier.trim(),
        name: values.name.trim(),
        tags: values.tags?.length > 0 ? values.tags : undefined,
      });
      message.success(t('benchmark.edit.success'));
      close();
      onSuccess?.();
    } catch {
      message.error(t('benchmark.edit.error'));
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

export default BenchmarkEditContent;
