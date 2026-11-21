'use client';

import { type DataExportView } from '@lobechat/types';
import { Button, Flexbox, Icon, toast } from '@lobehub/ui';
import dayjs from 'dayjs';
import { Download, HardDriveUpload } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { exportService } from '@/services/export';
import { downloadFile } from '@/utils/client/downloadFile';
import { formatSize } from '@/utils/format';

/** How often the row re-reads a running export; the export itself takes seconds to minutes. */
const PROCESSING_POLL_INTERVAL = 3000;

const LATEST_EXPORT_KEY = 'dataExport:latest';

interface DataExportItemOptions {
  /** Shown instead of the export status when the user may not export. */
  disabledReason?: ReactNode;
  enabled?: boolean;
}

interface DataExportItem {
  children: ReactNode;
  desc?: ReactNode;
}

/**
 * The "Export data" settings row. The export is built in the background and
 * stored, so the user can leave the page; the row shows the running export,
 * then the latest file to download, and the user is notified when it ends.
 */
export const useDataExportItem = ({
  disabledReason,
  enabled = true,
}: DataExportItemOptions = {}): DataExportItem => {
  const { t } = useTranslation('setting');
  const [starting, setStarting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { data: latest, mutate } = useClientDataSWR<DataExportView | null>(
    enabled ? LATEST_EXPORT_KEY : null,
    () => exportService.getLatestExport(),
    {
      refreshInterval: (data?: DataExportView | null) =>
        data?.status === 'processing' ? PROCESSING_POLL_INTERVAL : 0,
    },
  );

  const start = useCallback(async () => {
    setStarting(true);
    try {
      await mutate(await exportService.startExport(), { revalidate: false });
    } catch (error) {
      console.error('[dataExport] start failed:', error);
      toast.error(t('storage.actions.export.startError'));
    } finally {
      setStarting(false);
    }
  }, [mutate, t]);

  const download = useCallback(async () => {
    if (!latest) return;
    setDownloading(true);
    try {
      const { fileName, url } = await exportService.getExportDownloadUrl(latest.id);
      await downloadFile(url, fileName);
    } catch (error) {
      console.error('[dataExport] download failed:', error);
      toast.error(t('storage.actions.export.downloadError'));
    } finally {
      setDownloading(false);
    }
  }, [latest, t]);

  if (!enabled) {
    return {
      children: (
        <Button disabled icon={<Icon icon={HardDriveUpload} />}>
          {t('storage.actions.export.button')}
        </Button>
      ),
      desc: disabledReason,
    };
  }

  if (latest?.status === 'processing') {
    return {
      children: (
        <Button loading icon={<Icon icon={HardDriveUpload} />}>
          {t('storage.actions.export.exporting')}
        </Button>
      ),
      desc: t('storage.actions.export.exportingDesc'),
    };
  }

  const exportButton = (
    <Button icon={<Icon icon={HardDriveUpload} />} loading={starting} onClick={start}>
      {t(latest ? 'storage.actions.export.rerun' : 'storage.actions.export.button')}
    </Button>
  );

  if (latest?.status === 'success') {
    return {
      children: (
        <Flexbox horizontal gap={8}>
          {exportButton}
          <Button
            icon={<Icon icon={Download} />}
            loading={downloading}
            type={'primary'}
            onClick={download}
          >
            {t('storage.actions.export.download')}
          </Button>
        </Flexbox>
      ),
      desc: t('storage.actions.export.ready', {
        size: latest.fileSize === undefined ? '-' : formatSize(latest.fileSize),
        time: dayjs(latest.completedAt ?? latest.createdAt).format('YYYY-MM-DD HH:mm'),
      }),
    };
  }

  if (latest?.status === 'error') {
    return { children: exportButton, desc: t('storage.actions.export.failed') };
  }

  return { children: exportButton };
};
