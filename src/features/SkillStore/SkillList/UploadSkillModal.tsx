'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import {
  Alert,
  createModal,
  type ModalInstance,
  Spin,
  Text,
  toast,
  Upload,
  useModalContext,
} from '@lobehub/ui';
import { sha256 } from 'js-sha256';
import { ArrowLeftRight, InboxIcon, Sparkles, Upload as UploadIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { lambdaClient } from '@/libs/trpc/client/lambda';
import { uploadService } from '@/services/upload';
import { useToolStore } from '@/store/tool';

const UploadSkillContent = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const { close, setCanDismissByClickOutside } = useModalContext();

  const importAgentSkillFromZip = useToolStore((s) => s.importAgentSkillFromZip);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { allowed: canCreate } = usePermission('create_content');

  useEffect(() => {
    setCanDismissByClickOutside(!loading);
  }, [loading, setCanDismissByClickOutside]);

  const handleUploadFile = async (file: File) => {
    if (!canCreate) return;
    setLoading(true);
    setError(null);
    let uploadedPathname: string | undefined;

    try {
      const { data: metadata } = await uploadService.uploadFileToS3(file, {
        directory: 'skills',
      });
      uploadedPathname = metadata.path;

      const hash = sha256(await file.arrayBuffer());

      const result = await lambdaClient.file.createFile.mutate({
        fileType: file.type || 'application/zip',
        hash,
        metadata: {},
        name: file.name,
        size: file.size,
        url: metadata.path,
      });
      uploadedPathname = undefined;

      await importAgentSkillFromZip({ zipFileId: result.id });
      toast.success(t('agentSkillModal.importSuccess'));
      close();
    } catch (err: any) {
      if (uploadedPathname) await uploadService.releaseUpload(uploadedPathname);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Flexbox align="center" gap={16} padding={'16px 0'}>
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={UploadIcon} size={28} />
          <Icon
            icon={ArrowLeftRight}
            size={16}
            style={{ color: 'var(--ant-color-text-tertiary)' }}
          />
          <Icon icon={Sparkles} size={28} />
        </Flexbox>

        <Flexbox align="center" gap={4}>
          <Text as={'h4'} style={{ margin: 0 }}>
            {t('agentSkillModal.upload.title')}
          </Text>
          <Text type={'secondary'}>{t('agentSkillModal.upload.desc')}</Text>
        </Flexbox>
      </Flexbox>

      {error && <Alert showIcon title={t('agentSkillModal.importError', { error })} type="error" />}

      <Upload
        dragger
        accept=".zip,.skill"
        disabled={loading || !canCreate}
        onFiles={([file]) => void handleUploadFile(file)}
      >
        <Flexbox align="center" gap={8} padding={24}>
          {loading ? (
            <>
              <Spin />
              <Text type={'secondary'}>{t('agentSkillModal.upload.uploading')}</Text>
            </>
          ) : (
            <>
              <Icon
                icon={InboxIcon}
                size={48}
                style={{ color: 'var(--ant-color-text-quaternary)' }}
              />
              <Text type={'secondary'}>{t('agentSkillModal.upload.dragText')}</Text>
            </>
          )}
        </Flexbox>
      </Upload>

      <Flexbox gap={8}>
        <Text strong>{t('agentSkillModal.upload.requirements')}</Text>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <Text as={'span'} type={'secondary'}>
              {t('agentSkillModal.upload.requirementZip')}
            </Text>
          </li>
          <li>
            <Text as={'span'} type={'secondary'}>
              {t('agentSkillModal.upload.requirementSkillMd')}
            </Text>
          </li>
        </ul>
      </Flexbox>
    </Flexbox>
  );
});

UploadSkillContent.displayName = 'UploadSkillContent';

export const openUploadSkillModal = (): ModalInstance =>
  createModal({
    content: <UploadSkillContent />,
    footer: null,
    maskClosable: true,
    width: 480,
  });
