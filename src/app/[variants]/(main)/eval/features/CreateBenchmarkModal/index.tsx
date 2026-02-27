'use client';

import { Input, Modal, type ModalProps, Select, TextArea } from '@lobehub/ui';
import { App, Form } from 'antd';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useEvalStore } from '@/store/eval';

const toIdentifier = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, '-')
    .replaceAll(/[^\da-z-]/g, '');

interface CreateBenchmarkModalProps extends ModalProps {}

const CreateBenchmarkModal = memo<CreateBenchmarkModalProps>(({ open, onCancel }) => {
  const { t } = useTranslation('eval');
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const createBenchmark = useEvalStore((s) => s.createBenchmark);

  const nameValue = Form.useWatch('name', form);

  // Auto-sync identifier from name, unless user has manually edited it
  useEffect(() => {
    if (!identifierTouched && nameValue) {
      form.setFieldValue('identifier', toIdentifier(nameValue));
    }
  }, [nameValue, identifierTouched, form]);

  return (
    <Modal
      allowFullscreen
      destroyOnHidden
      okButtonProps={{ loading }}
      okText={t('benchmark.create.confirm')}
      onCancel={(e) => {
        form.resetFields();
        setIdentifierTouched(false);
        onCancel?.(e);
      }}
      onOk={async (e) => {
        try {
          const values = await form.validateFields();
          setLoading(true);

          const result = await createBenchmark({
            identifier: values.identifier.trim(),
            name: values.name.trim(),
            description: values.description?.trim() || undefined,
            tags: values.tags?.length > 0 ? values.tags : undefined,
          });
          message.success(t('benchmark.create.success'));
          form.resetFields();
          setIdentifierTouched(false);
          onCancel?.(e);
          if (result?.id) {
            navigate(`/eval/bench/${result.id}`);
          }
        } catch (error: any) {
          if (error?.errorFields) return;
          message.error(t('benchmark.create.error'));
        } finally {
          setLoading(false);
        }
      }}
      open={open}
      title={t('benchmark.create.title')}
      width={480}
    >
      <Form form={form} layout="vertical" style={{ paddingBlock: 16 }}>
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
            onChange={() => setIdentifierTouched(true)}
            placeholder={t('benchmark.create.identifier.placeholder')}
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
    </Modal>
  );
});

export default CreateBenchmarkModal;
