'use client';

import { Flexbox } from '@lobehub/ui';
import { Input, Text, toast } from '@lobehub/ui/base-ui';
import { Form, useForm } from '@lobehub/ui/base-ui/form';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { lambdaClient } from '@/libs/trpc/client';

import { isGithubRepoUrl } from './githubRepoUrl';

interface SubmitRepoModalProps {
  beforeSubmit?: () => Promise<{ actAs?: number } | void>;
  onClose: () => void;
  onSuccess?: () => void;
  open: boolean;
}

export const SubmitRepoModal = memo<SubmitRepoModalProps>(
  ({ open, onClose, onSuccess, beforeSubmit }) => {
    const { t } = useTranslation('discover');

    const form = useForm<{ gitUrl?: string }>();

    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = useCallback(async () => {
      try {
        const { valid } = await form.validate();
        if (!valid) return;
        const gitUrl = form.getValue('gitUrl')?.trim();

        if (!gitUrl) {
          return;
        }

        setIsSubmitting(true);

        const submitContext = await beforeSubmit?.();

        await lambdaClient.market.socialProfile.submitRepo.mutate({
          actAs: submitContext?.actAs,
          gitUrl,
          type: 'skill',
        });

        toast.success(t('user.submitRepoSuccess'));
        onSuccess?.();
        onClose();
        form.reset();
      } catch (error) {
        console.error('[SubmitRepoModal] Failed to submit:', error);
        toast.error(error instanceof Error ? error.message : t('user.submitRepoError'));
      } finally {
        setIsSubmitting(false);
      }
    }, [beforeSubmit, form, t, onSuccess, onClose]);

    const handleCancel = useCallback(() => {
      form.reset();
      onClose();
    }, [form, onClose]);

    return (
      <ImperativeModal
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
          <Form.Field
            label={t('user.githubUrl')}
            name="gitUrl"
            required={t('user.githubUrlRequired')}
            validate={(value: string) =>
              value && !isGithubRepoUrl(value) ? t('user.githubUrlInvalid') : undefined
            }
          >
            <Input placeholder="https://github.com/username/repo" />
          </Form.Field>
        </Form>

        <Flexbox style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('user.submitRepoHint')}
          </Text>
        </Flexbox>
      </ImperativeModal>
    );
  },
);

SubmitRepoModal.displayName = 'SubmitRepoModal';

export default SubmitRepoModal;
