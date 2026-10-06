'use client';

import { Input, Select, TextArea, toast, useModalContext } from '@lobehub/ui/base-ui';
import { Form, useForm, useWatch } from '@lobehub/ui/base-ui/form';
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

  const navigate = useWorkspaceAwareNavigate();
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const createBenchmark = useEvalStore((s) => s.createBenchmark);

  const handleFinish = async (values: any) => {
    onLoadingChange?.(true);
    try {
      const result = await createBenchmark({
        description: values.description?.trim() || undefined,
        identifier: values.identifier.trim(),
        name: values.name.trim(),
        tags: values.tags?.length > 0 ? values.tags : undefined,
      });
      toast.success(t('benchmark.create.success'));
      close();
      if (result?.id) {
        navigate(`/eval/bench/${result.id}`);
      }
    } catch {
      toast.error(t('benchmark.create.error'));
    } finally {
      onLoadingChange?.(false);
    }
  };

  const form = useForm({
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

export default CreateBenchmarkContent;
