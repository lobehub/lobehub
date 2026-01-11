'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { Flexbox } from '@lobehub/ui';
import { Modal, Typography } from 'antd';
import { Clock } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';

import CronJobCards from './CronJobCards';
import CronJobForm from './CronJobForm';
import { useAgentCronJobs } from './hooks/useAgentCronJobs';

const { Title } = Typography;

interface AgentCronJobsProps {
  onFormModalChange?: (show: boolean) => void;
  showFormModal?: boolean;
}

const AgentCronJobs = memo<AgentCronJobsProps>(({ showFormModal, onFormModalChange }) => {
  const { t } = useTranslation('setting');
  const agentId = useAgentStore((s) => s.activeAgentId);
  const [internalShowForm, setInternalShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<any>(null);

  // Use external control if provided, otherwise use internal state
  const showForm = showFormModal ?? internalShowForm;
  const setShowForm = onFormModalChange ?? setInternalShowForm;

  const { cronJobs, loading, createCronJob, updateCronJob, deleteCronJob } =
    useAgentCronJobs(agentId);

  if (!ENABLE_BUSINESS_FEATURES) return null;

  if (!agentId) {
    return null;
  }

  const handleCreate = async (data: any) => {
    setSubmitting(true);
    try {
      await createCronJob(data);
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (jobId: string) => {
    setEditingJob(jobId);
    setShowForm(true);
  };

  const handleUpdate = async (data: any) => {
    if (editingJob) {
      setSubmitting(true);
      try {
        await updateCronJob(editingJob, data);
        setShowForm(false);
        setEditingJob(null);
      } finally {
        setSubmitting(false);
      }
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingJob(null);
    formRef.current?.resetFields();
  };

  const handleModalOk = () => {
    formRef.current?.submit();
  };

  const handleDelete = async (jobId: string) => {
    await deleteCronJob(jobId);
  };

  const hasCronJobs = cronJobs && cronJobs.length > 0;

  return (
    <>
      {/* Show cards section only if there are jobs */}
      {hasCronJobs && (
        <Flexbox gap={12} style={{ marginBottom: 16, marginTop: 16 }}>
          <Title level={5} style={{ margin: 0 }}>
            <Flexbox align="center" gap={8} horizontal>
              <Clock size={16} />
              {t('agentCronJobs.title')}
            </Flexbox>
          </Title>

          <CronJobCards
            cronJobs={cronJobs}
            loading={loading}
            onDelete={handleDelete}
            onEdit={handleEdit}
          />
        </Flexbox>
      )}

      {/* Form Modal */}
      <Modal
        confirmLoading={submitting}
        okText={editingJob ? t('agentCronJobs.save' as any) : t('agentCronJobs.create' as any)}
        onCancel={handleCancel}
        onOk={handleModalOk}
        open={showForm}
        title={editingJob ? t('agentCronJobs.editJob') : t('agentCronJobs.addJob')}
        width={640}
      >
        <CronJobForm
          editingJob={editingJob ? cronJobs?.find((job) => job.id === editingJob) : undefined}
          formRef={formRef}
          onCancel={handleCancel}
          onSubmit={editingJob ? handleUpdate : handleCreate}
        />
      </Modal>
    </>
  );
});

export default AgentCronJobs;
