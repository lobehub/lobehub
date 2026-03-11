import { Ollama } from '@lobehub/icons';
import { Alert, Button, Center, Flexbox, Input } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormAction from '@/components/FormAction';
import { useActionSWR } from '@/libs/swr';
import { type ModelProgressInfo } from '@/services/models';
import { modelsService } from '@/services/models';
import { formatSize } from '@/utils/format';

import { useDownloadMonitor } from './useDownloadMonitor';

interface OllamaModelDownloaderProps {
  extraAction?: ReactNode;
  model: string;
  onSuccessDownload?: () => void;
}

const OllamaModelDownloader = memo<OllamaModelDownloaderProps>(
  ({ model, onSuccessDownload, extraAction }) => {
    const { t } = useTranslation(['modelProvider', 'error']);

    const [modelToPull, setModelToPull] = useState(model);
    const [completed, setCompleted] = useState(0);
    const [total, setTotal] = useState(0);
    const { remainingTime, downloadSpeed } = useDownloadMonitor(total, completed);
    const percent = useMemo(() => {
      return total ? Number(((completed / total) * 100).toFixed(1)) : 0;
    }, [completed, total]);

    // 定义进度回调函数
    const handleProgress = useCallback((progress: ModelProgressInfo) => {
      if (progress.completed) setCompleted(progress.completed);
      if (progress.total) setTotal(progress.total);
    }, []);

    const {
      mutate,
      isValidating: isDownloading,
      error,
    } = useActionSWR(
      ['ollama.downloadModel', modelToPull],
      async () => {
        await modelsService.downloadModel(
          { model: modelToPull, provider: 'ollama' },
          { onProgress: handleProgress },
        );

        return true;
      },
      {
        onSuccess: onSuccessDownload,
      },
    );

    return (
      <Center gap={16} paddingBlock={32} style={{ width: '100%' }}>
        <FormAction
          avatar={<Ollama color={cssVar.colorPrimary} size={64} />}
          description={isDownloading ? t('ollama.download.desc') : t('ollama.unlock.description')}
          title={
            isDownloading
              ? t('ollama.download.title', { model: modelToPull })
              : t('ollama.unlock.title')
          }
        >
          {!isDownloading && (
            <Input
              value={modelToPull}
              onChange={(e) => {
                setModelToPull(e.target.value);
              }}
            />
          )}
        </FormAction>
        {isDownloading && (
          <Flexbox flex={1} gap={8} style={{ maxWidth: 300 }} width={'100%'}>
            <Progress
              showInfo
              percent={percent}
              strokeColor={cssVar.colorSuccess}
              trailColor={cssVar.colorSuccessBg}
            />
            <Flexbox
              horizontal
              distribution={'space-between'}
              style={{ color: cssVar.colorTextDescription, fontSize: 12 }}
            >
              <span>
                {t('ollama.download.remainingTime')}: {remainingTime}
              </span>
              <span>
                {t('ollama.download.speed')}: {downloadSpeed}
              </span>
            </Flexbox>
          </Flexbox>
        )}
        <Flexbox gap={12} style={{ maxWidth: 300 }} width={'100%'}>
          {error?.message && (
            <Alert
              closable
              description={error.message}
              showIcon={false}
              title={t('ollama.download.failed')}
              type={'error'}
            />
          )}
          <Button
            block
            loading={isDownloading}
            style={{ marginTop: 8 }}
            type={'primary'}
            onClick={() => {
              mutate();
            }}
          >
            {!isDownloading
              ? t('ollama.unlock.confirm')
              : // if total is 0, show starting, else show downloaded
                !total
                ? t('ollama.unlock.starting')
                : t('ollama.unlock.downloaded', {
                    completed: formatSize(completed, 2),
                    total: formatSize(total, 2),
                  })}
          </Button>
          {isDownloading ? (
            <Button
              onClick={() => {
                modelsService.abortPull();
              }}
            >
              {t('ollama.unlock.cancel')}
            </Button>
          ) : (
            extraAction
          )}
        </Flexbox>
      </Center>
    );
  },
);

export default OllamaModelDownloader;
