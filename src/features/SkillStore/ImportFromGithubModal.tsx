'use client';

import { Alert, Flexbox, Icon, Input } from '@lobehub/ui';
import { App, Button, Modal, Typography } from 'antd';
import { ArrowLeftRight, Github, Sparkles } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client/lambda';

interface ImportFromGithubModalProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const ImportFromGithubModal = memo<ImportFromGithubModalProps>(({ open, onOpenChange }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  const handleClose = () => {
    onOpenChange(false);
    setError(null);
    setUrl('');
  };

  const handleImport = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      await lambdaClient.agentSkills.importFromGitHub.mutate({ gitUrl: trimmed });
      message.success(t('agentSkillModal.importSuccess'));
      handleClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal destroyOnClose footer={null} onCancel={handleClose} open={open} title={null} width={480}>
      <Flexbox align="center" gap={16} padding={'16px 0'}>
        <Flexbox align="center" gap={8} horizontal>
          <Icon icon={Github} size={28} />
          <Icon
            icon={ArrowLeftRight}
            size={16}
            style={{ color: 'var(--ant-color-text-tertiary)' }}
          />
          <Icon icon={Sparkles} size={28} />
        </Flexbox>

        <Flexbox align="center" gap={4}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('agentSkillModal.github.title')}
          </Typography.Title>
          <Typography.Text type="secondary">{t('agentSkillModal.github.desc')}</Typography.Text>
        </Flexbox>
      </Flexbox>

      <Flexbox gap={16}>
        {error && (
          <Alert showIcon title={t('agentSkillModal.importError', { error })} type="error" />
        )}

        <Flexbox gap={8}>
          <Typography.Text strong>URL</Typography.Text>
          <Input
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            onPressEnter={handleImport}
            placeholder={t('agentSkillModal.github.urlPlaceholder')}
            value={url}
          />
        </Flexbox>

        <Button block loading={loading} onClick={handleImport} type="primary">
          {t('common:import')}
        </Button>
      </Flexbox>
    </Modal>
  );
});

ImportFromGithubModal.displayName = 'ImportFromGithubModal';

export default ImportFromGithubModal;
