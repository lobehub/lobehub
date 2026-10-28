// Fixture: a warning Alert with a translated title; raw runtime errors sit in the collapsed `extra`.
// Reduced from WorkingSidebar Canvas/CanvasFrame.
import { Alert } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface RuntimeError {
  component?: string;
  message: string;
}

const RuntimeErrorNotice = memo<{ errors: RuntimeError[] }>(({ errors }) => {
  const { t } = useTranslation('portal');
  if (errors.length === 0) return null;

  return (
    <Alert
      description={t('canvas.runtimeErrorsHint')}
      title={t('canvas.runtimeErrors', { count: errors.length })}
      type={'warning'}
      extra={
        <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
          {errors
            .map((error) =>
              error.component ? `<${error.component}> ${error.message}` : error.message,
            )
            .join('\n')}
        </pre>
      }
    />
  );
});

export default RuntimeErrorNotice;
