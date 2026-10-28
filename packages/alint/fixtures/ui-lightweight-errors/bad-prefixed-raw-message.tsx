// Fixture: a translated "Error: {{message}}" prefix around the raw upload error is not a sentence.
// Reduced from EditorCanvas/LinearFilePlugin.
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const FileUploadState = memo<{ message?: string; name: string }>(({ message, name }) => {
  const { t } = useTranslation('editor');

  return (
    <div>
      <div>{name}</div>
      {/* alint-expect */}
      <div>{t('file.error', { message: message || 'Unknown error' })}</div>
    </div>
  );
});

export default FileUploadState;
