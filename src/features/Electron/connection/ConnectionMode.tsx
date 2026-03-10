import { type StorageMode } from '@lobechat/electron-client-ipc';
import { StorageModeEnum } from '@lobechat/electron-client-ipc';
import { Button, Center, Flexbox, Input, stopPropagation } from '@lobehub/ui';
import { LobeHub } from '@lobehub/ui/brand';
import { createStaticStyles } from 'antd-style';
import { Server } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

import { Option } from './Option';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    cardGroup: css`
      width: 400px; /* Increased width */
    `,
    container: css`
      overflow-y: auto;

      width: 100%;
      height: 100%;
      padding-block: 0 40px;
      padding-inline: 24px; /* Increased top padding */
    `,
    continueButton: css`
      width: 100%;
      margin-block-start: 40px;
    `,
    groupTitle: css`
      padding-inline-start: 4px; /* Align with card padding */
      font-size: 16px;
      font-weight: 500;
      color: ${cssVar.colorTextSecondary};
    `,
    header: css`
      text-align: center;
    `,
    inputError: css`
      margin-block-start: 8px;
      font-size: 12px;
      color: ${cssVar.colorError};
    `,
    modal: css`
      .ant-drawer-close {
        position: absolute;
        inset-block-start: 8px;
        inset-inline-end: 0;
      }
    `,
    selfHostedInput: css`
      margin-block-start: 12px;
    `,
    selfHostedText: css`
      cursor: pointer;
      font-size: 14px;
      color: ${cssVar.colorTextTertiary};

      :hover {
        color: ${cssVar.colorTextSecondary};
      }
    `,
    title: css`
      margin-block: 16px 48px; /* Increased Spacing below title */
      font-size: 24px; /* Increased font size */
      font-weight: 600;
      color: ${cssVar.colorTextHeading};
    `,
  };
});

type RemoteStorageMode = Extract<StorageMode, 'cloud' | 'selfHost'>;

interface ConnectionModeProps {
  setWaiting: (waiting: boolean) => void;
}

const ConnectionMode = memo<ConnectionModeProps>(({ setWaiting }) => {
  const { t } = useTranslation(['electron', 'common']);
  const [urlError, setUrlError] = useState<string | undefined>();

  const connect = useElectronStore((s) => s.connectRemoteServer);
  const storageMode = useElectronStore(electronSyncSelectors.storageMode);
  const rawRemoteServerUrl = useElectronStore(electronSyncSelectors.rawRemoteServerUrl);

  const [selectedOption, setSelectedOption] = useState<RemoteStorageMode>(
    storageMode === StorageModeEnum.SelfHost ? StorageModeEnum.SelfHost : StorageModeEnum.Cloud,
  );
  const [selfHostedUrl, setSelfHostedUrl] = useState(rawRemoteServerUrl);

  const validateUrl = useCallback((url: string) => {
    if (!url) {
      return t('remoteServer.urlRequired');
    }
    try {
      new URL(url);
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('Invalid protocol');
      }
      return undefined;
    } catch {
      return t('remoteServer.invalidUrl');
    }
  }, []);

  const handleSelectOption = (option: RemoteStorageMode) => {
    setSelectedOption(option);
    if (option !== StorageModeEnum.SelfHost) {
      setUrlError(undefined);
    } else {
      setUrlError(validateUrl(selfHostedUrl));
    }
  };

  const handleContinue = async () => {
    if (selectedOption === StorageModeEnum.SelfHost) {
      const error = validateUrl(selfHostedUrl);
      setUrlError(error);
      if (error) {
        return;
      }
    }

    // try to connect
    setWaiting(true);
    await connect({ remoteServerUrl: selfHostedUrl, storageMode: selectedOption });
  };

  return (
    <Center className={styles.container}>
      <Flexbox align={'center'} gap={0}>
        <h1 className={styles.title}>{t('sync.mode.title')}</h1>
      </Flexbox>

      <Flexbox className={styles.cardGroup} gap={24}>
        <Flexbox gap={16}>
          <Flexbox horizontal align="center" justify="space-between">
            <div className={styles.groupTitle}>{t('sync.mode.cloudSync')}</div>
            <div
              className={styles.selfHostedText}
              onClick={() => handleSelectOption(StorageModeEnum.SelfHost)}
            >
              {t('sync.mode.useSelfHosted')}
            </div>
          </Flexbox>
          <Option
            description={t('sync.lobehubCloud.description')}
            icon={LobeHub}
            isSelected={selectedOption === StorageModeEnum.Cloud}
            label={t('sync.lobehubCloud.title')}
            value={StorageModeEnum.Cloud}
            onClick={handleSelectOption}
          />
          {selectedOption === StorageModeEnum.SelfHost && (
            <Option
              description={t('sync.selfHosted.description')}
              icon={Server}
              isSelected={selectedOption === StorageModeEnum.SelfHost}
              label={t('sync.selfHosted.title')}
              value={StorageModeEnum.SelfHost}
              onClick={handleSelectOption}
            >
              {selectedOption === StorageModeEnum.SelfHost && (
                <>
                  <Input
                    autoFocus
                    className={styles.selfHostedInput}
                    placeholder="https://your-lobechat.com"
                    status={urlError ? 'error' : undefined}
                    value={selfHostedUrl}
                    onClick={stopPropagation}
                    onChange={(e) => {
                      const newUrl = e.target.value;
                      setSelfHostedUrl(newUrl);
                      setUrlError(validateUrl(newUrl));
                    }}
                  />
                  {urlError && <div className={styles.inputError}>{urlError}</div>}
                </>
              )}
            </Option>
          )}
        </Flexbox>
      </Flexbox>

      <Button
        className={styles.continueButton}
        size="large"
        style={{ maxWidth: 400 }}
        type="primary"
        disabled={
          !selectedOption ||
          (selectedOption === StorageModeEnum.SelfHost && (!!urlError || !selfHostedUrl))
        }
        onClick={handleContinue}
      >
        {t('sync.continue')}
      </Button>
    </Center>
  );
});

export default ConnectionMode;
