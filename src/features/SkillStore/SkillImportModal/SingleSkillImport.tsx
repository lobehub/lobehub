import { formatSize } from '@lobechat/utils/format';
import { Button, Flexbox, Icon, Input, Text, toast, Upload, useModalContext } from '@lobehub/ui';
import { sha256 } from 'js-sha256';
import { FileArchive, FileUp, Link } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { lambdaClient } from '@/libs/trpc/client/lambda';
import { uploadService } from '@/services/upload';
import { useToolStore } from '@/store/tool';

const uploadArchive = async (file: File) => {
  const { data } = await uploadService.uploadFileToS3(file, { directory: 'skills' });
  try {
    const record = await lambdaClient.file.createFile.mutate({
      fileType: file.type || 'application/zip',
      hash: sha256(await file.arrayBuffer()),
      metadata: {},
      name: file.name,
      size: file.size,
      url: data.path,
    });
    return record.id;
  } catch (error) {
    await uploadService.releaseUpload(data.path);
    throw error;
  }
};

interface SingleSkillImportProps {
  canCreate: boolean;
  loading: boolean;
  onLoadingChange: (loading: boolean) => void;
  source: 'url' | 'file';
}

export const SingleSkillImport = ({
  canCreate,
  loading,
  onLoadingChange,
  source,
}: SingleSkillImportProps) => {
  const { t } = useTranslation('setting');
  const { close } = useModalContext();
  const hintId = useId();
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File>();
  const [fileId, setFileId] = useState<string>();
  const [invalidUrl, setInvalidUrl] = useState(false);
  const [invalidFile, setInvalidFile] = useState(false);
  const [error, setError] = useState<string>();
  const fromUrl = useToolStore((s) => s.importAgentSkillFromUrl);
  const fromZip = useToolStore((s) => s.importAgentSkillFromZip);
  const isLink = source === 'url';
  const ready = isLink ? !!url.trim() : !!file;

  // Upload silently filters unsupported files before calling onFiles. Clear the
  // previous selection so an accidental drop cannot import the wrong package.
  const checkFileTypes = (files: FileList | null) => {
    if (!files?.length || loading || !canCreate) return;
    if (Array.from(files).some((entry) => /\.(zip|skill)$/i.test(entry.name))) return;
    setFile(undefined);
    setFileId(undefined);
    setError(undefined);
    setInvalidFile(true);
  };

  const submit = async () => {
    if (!ready || loading || !canCreate) return;
    if (
      isLink &&
      (!URL.canParse(url.trim()) || !['https:', 'http:'].includes(new URL(url.trim()).protocol))
    ) {
      setInvalidUrl(true);
      return;
    }
    onLoadingChange(true);
    setError(undefined);
    try {
      let result;
      if (isLink) {
        result = await fromUrl({ url: url.trim() });
      } else if (file) {
        const zipFileId = fileId ?? (await uploadArchive(file));
        setFileId(zipFileId);
        result = await fromZip({ zipFileId });
      }
      toast.success(
        result
          ? t(`agentSkillModal.result.${result.status}`, { name: result.skill.name })
          : t('agentSkillModal.importSuccess'),
      );
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      onLoadingChange(false);
    }
  };

  return (
    <Flexbox gap={20}>
      {isLink ? (
        <Flexbox gap={8}>
          <Input
            aria-describedby={hintId}
            aria-invalid={invalidUrl}
            aria-label={t('agentSkillModal.url.label')}
            disabled={loading || !canCreate}
            placeholder={t('agentSkillModal.url.urlPlaceholder')}
            prefix={<Icon icon={Link} />}
            value={url}
            onPressEnter={submit}
            onChange={(event) => {
              setUrl(event.target.value);
              setInvalidUrl(false);
              setError(undefined);
            }}
          />
          <Text
            fontSize={13}
            id={hintId}
            role={invalidUrl ? 'alert' : undefined}
            type={invalidUrl ? 'danger' : 'secondary'}
          >
            {t(invalidUrl ? 'agentSkillModal.url.invalid' : 'agentSkillModal.url.hint')}
          </Text>
        </Flexbox>
      ) : (
        <Flexbox gap={8}>
          <Upload
            dragger
            accept=".zip,.skill"
            aria-describedby={hintId}
            disabled={loading || !canCreate}
            maxCount={1}
            onDropCapture={(event) => checkFileTypes(event.dataTransfer.files)}
            onChangeCapture={(event) => {
              if (event.target instanceof HTMLInputElement) checkFileTypes(event.target.files);
            }}
            onFiles={([next]) => {
              setInvalidFile(false);
              setFile(next);
              setFileId(undefined);
              setError(undefined);
            }}
          >
            <Flexbox align="center" gap={6} padding={12}>
              <Icon icon={file ? FileArchive : FileUp} size={24} />
              <Text strong align="center" wordBreak="break-word">
                {file?.name ?? t('agentSkillModal.upload.choose')}
              </Text>
              <Text fontSize={13} type="secondary">
                {file
                  ? t('agentSkillModal.upload.replace', { size: formatSize(file.size) })
                  : '.zip / .skill'}
              </Text>
            </Flexbox>
          </Upload>
          <Text
            fontSize={13}
            id={hintId}
            role={invalidFile ? 'alert' : undefined}
            type={invalidFile ? 'danger' : 'secondary'}
          >
            {t(invalidFile ? 'agentSkillModal.upload.invalid' : 'agentSkillModal.upload.hint')}
          </Text>
        </Flexbox>
      )}
      {error && (
        <AsyncError
          align="start"
          details={error}
          title={t(isLink ? 'agentSkillModal.url.failed' : 'agentSkillModal.upload.failed')}
          variant="inline"
        />
      )}
      <Flexbox horizontal justify="flex-end">
        <Button disabled={!canCreate || !ready} loading={loading} type="primary" onClick={submit}>
          {t(loading ? 'agentSkillModal.importing' : 'agentSkillModal.title')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};
