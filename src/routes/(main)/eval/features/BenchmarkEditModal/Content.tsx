'use client';

import { cssVar, Input, Select, TextArea, toast, useModalContext } from '@lobehub/ui';
import { Form, useForm, useWatch } from '@lobehub/ui/form';
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

  const [identifierTouched, setIdentifierTouched] = useState(false);
  const updateBenchmark = useEvalStore((s) => s.updateBenchmark);

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
      identifier: benchmark.identifier,
      name: benchmark.name,
      tags: benchmark.tags || [],
    },
    onSubmit: handleFinish,
  });
  const nameValue = useWatch(form, 'name');

  useEffect(() => {
    if (!identifierTouched && nameValue) {
      form.setValue('identifier', toIdentifier(nameValue));
    }
  }, [nameValue, identifierTouched, form]);

  return (
    <Form form={form} id={formId} layout="vertical">
      <Form.Field
        label={t('benchmark.create.name.label')}
        name="name"
        required={t('benchmark.create.nameRequired')}
      >
        <Input autoFocus placeholder={t('benchmark.create.name.placeholder')} />
      </Form.Field>

      <Form.Field
        label={t('benchmark.create.identifier.label')}
        name="identifier"
        required={t('benchmark.create.identifierRequired')}
      >
        <Input
          placeholder={t('benchmark.create.identifier.placeholder')}
          style={{ fontFamily: cssVar.fontFamilyCode }}
          onChange={() => setIdentifierTouched(true)}
        />
      </Form.Field>

      <Form.Field label={t('benchmark.create.description.label')} name="description">
        <TextArea placeholder={t('benchmark.create.description.placeholder')} rows={3} />
      </Form.Field>

      <Form.Field label={t('benchmark.create.tags.label')} name="tags">
        <Select
          mode="tags"
          open={false}
          placeholder={t('benchmark.create.tags.placeholder')}
          style={{ width: '100%' }}
          tokenSeparators={[',', '，', ' ']}
        />
      </Form.Field>
    </Form>
  );
};

export default BenchmarkEditContent;
