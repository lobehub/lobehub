'use client';

import { Input, TextArea, toast, useModalContext } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { useEvalStore } from '@/store/eval';

export interface BenchmarkEditContentProps {
  benchmark: {
    description?: string;
    id: string;
    identifier: string;
    metadata?: any;
    name: string;
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

  const updateBenchmark = useEvalStore((s) => s.updateBenchmark);

  const handleFinish = async (values: any) => {
    onLoadingChange?.(true);
    try {
      await updateBenchmark({
        description: values.description?.trim() || undefined,
        id: benchmark.id,
        name: values.name.trim(),
      });
      toast.success(t('benchmark.edit.success'));
      close();
      onSuccess?.();
    } catch {
      toast.error(t('benchmark.edit.error'));
    } finally {
      onLoadingChange?.(false);
    }
  };

  const form = useForm({
    initialValues: {
      description: benchmark.description || '',
      name: benchmark.name,
    },
    onSubmit: handleFinish,
  });

  return (
    <Form form={form} id={formId} layout="vertical">
      <Form.Field
        label={t('benchmark.create.name.label')}
        name="name"
        required={t('benchmark.create.nameRequired')}
      >
        <Input autoFocus placeholder={t('benchmark.create.name.placeholder')} />
      </Form.Field>

      <Form.Field label={t('benchmark.create.description.label')} name="description">
        <TextArea placeholder={t('benchmark.create.description.placeholder')} rows={3} />
      </Form.Field>
    </Form>
  );
};

export default BenchmarkEditContent;
