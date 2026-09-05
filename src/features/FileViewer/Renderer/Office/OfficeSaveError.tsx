import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Download, RotateCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  error: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorErrorBorder};

    color: ${cssVar.colorError};

    background: ${cssVar.colorErrorBg};
  `,
  message: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface OfficeSaveErrorProps {
  error: unknown;
  onDownloadRecovery: () => void;
  onRetry: () => void;
}

const OfficeSaveError = memo<OfficeSaveErrorProps>(({ error, onDownloadRecovery, onRetry }) => {
  const { t } = useTranslation('file');
  const detail = error instanceof Error ? error.message : String(error);

  return (
    <Flexbox horizontal align="center" className={styles.error} gap={8} role="alert">
      <strong>{t('officeEditor.saveFailed')}</strong>
      <span className={styles.message} title={detail}>
        {detail}
      </span>
      <Button icon={RotateCw} size="small" onClick={onRetry}>
        {t('officeEditor.retrySave')}
      </Button>
      <Button icon={Download} size="small" onClick={onDownloadRecovery}>
        {t('officeEditor.downloadRecovery')}
      </Button>
    </Flexbox>
  );
});

OfficeSaveError.displayName = 'OfficeSaveError';

export default OfficeSaveError;
