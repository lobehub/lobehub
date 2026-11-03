'use client';

import type { AgentEvalExperiment } from '@lobechat/types';
import {
  Button,
  Input,
  ModalFooter,
  type ModalInstance,
  Select,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { t } from 'i18next';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { benchmarkSelectors, useEvalStore } from '@/store/eval';
import { createFormModal } from '@/utils/createFormModal';

interface ExperimentModalProps {
  experiment?: AgentEvalExperiment;
  onSuccess?: (id: string) => void;
}

interface ExperimentModalContentProps extends ExperimentModalProps {
  formId: string;
  onLoadingChange: (loading: boolean) => void;
}

const ExperimentModalContent = memo<ExperimentModalContentProps>(
  ({ experiment, formId, onLoadingChange, onSuccess }) => {
    const { t } = useTranslation('eval');

    const { close } = useModalContext();
    const createExperiment = useEvalStore((s) => s.createExperiment);
    const updateExperiment = useEvalStore((s) => s.updateExperiment);
    const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);
    const benchmarkList = useEvalStore(benchmarkSelectors.benchmarkList);

    useFetchBenchmarks();

    const handleSubmit = async (values: {
      benchmarkIds: string[];
      description?: string;
      name: string;
    }) => {
      onLoadingChange(true);
      try {
        const result = experiment
          ? await updateExperiment({ ...values, id: experiment.id })
          : await createExperiment(values);

        toast.success(experiment ? t('experiment.edit.success') : t('experiment.create.title'));
        close();
        onSuccess?.(result.id);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : experiment
              ? t('experiment.edit.error')
              : t('experiment.create.error'),
        );
      } finally {
        onLoadingChange(false);
      }
    };

    const form = useForm({
      initialValues: experiment
        ? {
            benchmarkIds: experiment.benchmarks.map((benchmark) => benchmark.id),
            description: experiment.description || undefined,
            name: experiment.name,
          }
        : undefined,
      onSubmit: handleSubmit,
    });

    return (
      <Form form={form} id={formId} layout="vertical">
        <Form.Field
          label={t('experiment.create.name.label')}
          name="name"
          required={t('experiment.create.nameRequired')}
        >
          <Input placeholder={t('experiment.create.name.placeholder')} />
        </Form.Field>

        <Form.Field label={t('experiment.create.description.label')} name="description">
          <TextArea placeholder={t('experiment.create.description.placeholder')} rows={3} />
        </Form.Field>

        <Form.Field
          label={t('experiment.create.benchmarks.label')}
          name="benchmarkIds"
          required={t('experiment.create.benchmarksRequired')}
        >
          <Select
            mode="multiple"
            placeholder={t('experiment.create.benchmarks.placeholder')}
            options={benchmarkList.map((benchmark) => ({
              label: benchmark.name,
              value: benchmark.id,
            }))}
          />
        </Form.Field>
      </Form>
    );
  },
);

const ExperimentModalFooter = memo<{
  formId: string;
  loading: boolean;
  submitText: string;
}>(({ formId, loading, submitText }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();

  return (
    <ModalFooter>
      <Button disabled={loading} onClick={close}>
        {t('common.cancel')}
      </Button>
      <Button form={formId} htmlType="submit" loading={loading} type="primary">
        {submitText}
      </Button>
    </ModalFooter>
  );
});

export const createExperimentModal = ({
  experiment,
  onSuccess,
}: ExperimentModalProps = {}): ModalInstance =>
  createFormModal({
    renderContent: ({ formId, setLoading }) => (
      <ExperimentModalContent
        experiment={experiment}
        formId={formId}
        onLoadingChange={setLoading}
        onSuccess={onSuccess}
      />
    ),
    renderFooter: ({ formId, loading }) => (
      <ExperimentModalFooter
        formId={formId}
        loading={loading}
        submitText={t(experiment ? 'common.update' : 'common.create', { ns: 'eval' })}
      />
    ),
    title: t(experiment ? 'experiment.edit.title' : 'experiment.create.title', { ns: 'eval' }),
    width: 520,
  });
