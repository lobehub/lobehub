'use client';

import { Flexbox, Modal, Text } from '@lobehub/ui';
import { App, Form, Input } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';

interface SubmitRepoModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  open: boolean;
}

const GITHUB_URL_REGEX = /^https?:\/\/github\.com\/[\w-]+\/[\w.-]+\/?$/;

export const SubmitRepoModal = memo<SubmitRepoModalProps>(({ open, onClose, onSuccess }) => {
  const { t } = useTranslation('discover');
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const gitUrl = values.gitUrl?.trim();

      if (!gitUrl) {
        return;
      }

      setIsSubmitting(true);

      await lambdaClient.market.socialProfile.submitRepo.mutate({ gitUrl, type: 'skill' });

      message.success(t('user.submitRepoSuccess'));
      onSuccess?.();
      onClose();
      form.resetFields();
    } catch (error) {
      console.error('[SubmitRepoModal] Failed to submit:', error);
      message.error(error instanceof Error ? error.message : t('user.submitRepoError'));
    } finally {
      setIsSubmitting(false);
    }
  }, [form, message, t, onSuccess, onClose]);

  const handleCancel = useCallback(() => {
    form.resetFields();
    onClose();
  }, [form, onClose]);

  return (
    <Modal
      centered
      cancelText={t('user.cancel')}
      confirmLoading={isSubmitting}
      okText={t('user.submit')}
      open={open}
      title={false}
      width={480}
      onCancel={handleCancel}
      onOk={handleSubmit}
    >
      <Text strong fontSize={20} style={{ display: 'block', marginBottom: 8, marginTop: 16 }}>
        {t('user.submitRepoTitle')}
      </Text>
      <Text style={{ display: 'block', marginBottom: 16 }} type="secondary">
        {t('user.submitRepoDescription')}
      </Text>

      <Form form={form} layout="vertical">
        <Form.Item
          label={t('user.githubUrl')}
          name="gitUrl"
          rules={[
            { required: true, message: t('user.githubUrlRequired') },
            {
              pattern: GITHUB_URL_REGEX,
              message: t('user.githubUrlInvalid'),
            },
          ]}
        >
          <Input placeholder="https://github.com/username/repo" />
        </Form.Item>
      </Form>

      <Flexbox style={{ marginTop: 8 }}>
        <Text style={{ fontSize: 12 }} type="secondary">
          {t('user.submitRepoHint')}
        </Text>
      </Flexbox>
    </Modal>
  );
});

SubmitRepoModal.displayName = 'SubmitRepoModal';

export default SubmitRepoModal;
