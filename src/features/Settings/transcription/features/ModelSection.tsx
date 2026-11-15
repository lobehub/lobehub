'use client';

import {
  type LocalAsrModelPackId,
  type LocalAsrModelPackState,
  type LocalAsrModelProgressPayload,
  useWatchBroadcast,
} from '@lobechat/electron-client-ipc';
import { Button, confirmModal, Flexbox, Progress, Tag, Text, toast } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import InfoTooltip from '@/components/InfoTooltip';
import { FORM_STYLE } from '@/const/layoutTokens';
import { electronLocalAsrService } from '@/services/electron/localAsr';
import { formatSize, formatSpeed } from '@/utils/format';

const STATUS_COLOR: Record<LocalAsrModelPackState['status'], string> = {
  corrupted: 'error',
  downloading: 'processing',
  not_downloaded: 'default',
  ready: 'success',
  verifying: 'processing',
};

interface PackRowProps {
  onSettled: () => void;
  pack: LocalAsrModelPackState;
  progress?: LocalAsrModelProgressPayload;
}

const PackActions = ({ pack, progress, onSettled }: PackRowProps) => {
  const { t } = useTranslation('setting');
  const [verifying, setVerifying] = useState(false);
  const status = progress?.status ?? pack.status;
  const name = t(`localAsr.models.pack.${pack.id}`);

  const download = () => electronLocalAsrService.downloadModel(pack.id).then(onSettled);

  const verify = async () => {
    setVerifying(true);
    try {
      const state = await electronLocalAsrService.verifyModel(pack.id);
      if (state.status === 'ready') toast.success(t('localAsr.models.verifyOk'));
      else toast.error(t('localAsr.models.verifyFailed'));
    } finally {
      setVerifying(false);
      onSettled();
    }
  };

  const remove = () =>
    confirmModal({
      content: t('localAsr.models.deleteConfirm.desc', { size: formatSize(pack.totalBytes) }),
      okButtonProps: { danger: true },
      okText: t('localAsr.models.delete'),
      onOk: async () => {
        await electronLocalAsrService.deleteModel(pack.id);
        onSettled();
      },
      title: t('localAsr.models.deleteConfirm.title', { name }),
    });

  if (status === 'downloading') {
    return (
      <Button size={'small'} onClick={() => electronLocalAsrService.cancelModelDownload(pack.id)}>
        {t('localAsr.models.pause')}
      </Button>
    );
  }

  if (status === 'ready' || status === 'verifying') {
    return (
      <Flexbox horizontal gap={8}>
        <Button loading={verifying || status === 'verifying'} size={'small'} onClick={verify}>
          {t('localAsr.models.verify')}
        </Button>
        <Button danger size={'small'} onClick={remove}>
          {t('localAsr.models.delete')}
        </Button>
      </Flexbox>
    );
  }

  const resumable = pack.downloadedBytes > 0;
  return (
    <Flexbox horizontal gap={8}>
      <Button size={'small'} onClick={download}>
        {status === 'corrupted'
          ? t('localAsr.models.redownload')
          : resumable
            ? t('localAsr.models.resume')
            : t('localAsr.models.download')}
      </Button>
      {resumable && (
        <Button danger size={'small'} onClick={remove}>
          {t('localAsr.models.delete')}
        </Button>
      )}
    </Flexbox>
  );
};

const PackDescription = ({ pack, progress }: Omit<PackRowProps, 'onSettled'>) => {
  const { t } = useTranslation('setting');
  const status = progress?.status ?? pack.status;
  const downloaded = progress?.downloadedBytes ?? pack.downloadedBytes;
  const percent = pack.totalBytes ? Math.floor((downloaded / pack.totalBytes) * 100) : 0;
  const error = progress?.error ?? pack.error;

  return (
    <Flexbox gap={6}>
      <span>
        {pack.description} · {formatSize(pack.totalBytes)}
      </span>
      {status === 'downloading' && (
        <Flexbox gap={2} style={{ maxWidth: 360 }}>
          <Progress percent={percent} size={'small'} />
          <Text fontSize={12} type={'secondary'}>
            {t('localAsr.models.progress', {
              downloaded: formatSize(downloaded),
              speed: progress?.speed ? formatSpeed(progress.speed, 1) : '--',
              total: formatSize(pack.totalBytes),
            })}
          </Text>
        </Flexbox>
      )}
      {/* The row description sits inside the field <label>, so the raw error is
          folded into a hover tooltip rather than a button toggle that the label
          would activate on every click. */}
      {status === 'corrupted' && error && (
        <Flexbox horizontal align={'center'} gap={4}>
          <Text fontSize={12} type={'danger'}>
            {t('localAsr.models.corruptedHint')}
          </Text>
          <InfoTooltip size={12} title={error} />
        </Flexbox>
      )}
    </Flexbox>
  );
};

interface ModelSectionProps {
  modelDir: string;
  onSettled: () => void;
  packs: LocalAsrModelPackState[];
}

const ModelSection = ({ packs, modelDir, onSettled }: ModelSectionProps) => {
  const { t } = useTranslation('setting');
  const form = useForm();
  const [progress, setProgress] = useState<
    Partial<Record<LocalAsrModelPackId, LocalAsrModelProgressPayload>>
  >({});

  useWatchBroadcast('localAsrModelProgress', (payload) => {
    const active = payload.status === 'downloading' || payload.status === 'verifying';
    setProgress((prev) => ({ ...prev, [payload.id]: active ? payload : undefined }));
    if (!active) onSettled();
  });

  const group: FormGroupItem = {
    children: packs.map((pack) => {
      const status = progress[pack.id]?.status ?? pack.status;
      return {
        children: <PackActions pack={pack} progress={progress[pack.id]} onSettled={onSettled} />,
        desc: <PackDescription pack={pack} progress={progress[pack.id]} />,
        label: (
          <Flexbox horizontal align={'center'} gap={8}>
            <Text>{t(`localAsr.models.pack.${pack.id}`)}</Text>
            <Tag>{t(pack.required ? 'localAsr.models.required' : 'localAsr.models.optional')}</Tag>
            <Tag color={STATUS_COLOR[status]} data-testid={`local-asr-pack-status-${pack.id}`}>
              {t(`localAsr.models.status.${status}`)}
            </Tag>
          </Flexbox>
        ),
        minWidth: undefined,
      };
    }),
    desc: t('localAsr.models.desc', { dir: modelDir }),
    title: t('localAsr.models.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[group]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
};

export default ModelSection;
