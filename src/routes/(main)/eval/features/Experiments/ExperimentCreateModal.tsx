'use client';

import type { AgentEvalExperiment } from '@lobechat/types';
import {
  Button,
  ModalFooter,
  type ModalInstance,
  Select,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { App, Form, Input } from 'antd';
import { t } from 'i18next';
import { memo, useEffect } from 'react';
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
    const { message } = App.useApp();
    const { close } = useModalContext();
    const [form] = Form.useForm();
    const createExperiment = useEvalStore((s) => s.createExperiment);
    const updateExperiment = useEvalStore((s) => s.updateExperiment);
    const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);
    const benchmarkList = useEvalStore(benchmarkSelectors.benchmarkList);

    useFetchBenchmarks();

    useEffect(() => {
      if (experiment) {
        form.setFieldsValue({
          benchmarkIds: experiment.benchmarks.map((benchmark) => benchmark.id),
          description: experiment.description || undefined,
          name: experiment.name,
        });
      }
    }, [experiment, form]);

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

        message.success(experiment ? t('experiment.edit.success') : t('experiment.create.title'));
        close();
        onSuccess?.(result.id);
      } catch (error) {
        message.error(
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

    return (
      <Form form={form} id={formId} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          label={t('experiment.create.name.label')}
          name="name"
          rules={[{ message: t('experiment.create.nameRequired'), required: true }]}
        >
          <Input placeholder={t('experiment.create.name.placeholder')} />
        </Form.Item>

        <Form.Item label={t('experiment.create.description.label')} name="description">
          <Input.TextArea placeholder={t('experiment.create.description.placeholder')} rows={3} />
        </Form.Item>

        <Form.Item
          label={t('experiment.create.benchmarks.label')}
          name="benchmarkIds"
          rules={[{ message: t('experiment.create.benchmarksRequired'), required: true }]}
        >
          <Select
            mode="multiple"
            placeholder={t('experiment.create.benchmarks.placeholder')}
            options={benchmarkList.map((benchmark) => ({
              label: benchmark.name,
              value: benchmark.id,
            }))}
          />
        </Form.Item>
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
