// Fixture: a compact error tag; the raw provider error is folded into its hover tooltip.
// Reduced from FileParsingStatus (chunking / embedding error tags).
import { Flexbox, Icon, Tag, Tooltip } from '@lobehub/ui';
import { RotateCwIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface TaskError {
  body?: string | { detail?: string };
  name: string;
}

const ChunkingErrorTag = memo<{ error?: TaskError; onRetry: () => void }>(({ error, onRetry }) => {
  const { t } = useTranslation('components');

  return (
    <Tooltip
      styles={{ root: { maxWidth: 340 } }}
      title={
        <Flexbox gap={4}>
          {t('FileParsingStatus.chunks.status.errorResult')}
          {error && (
            <Flexbox style={{ fontFamily: 'monospace', fontSize: 12 }}>
              [{error.name}]: {typeof error.body === 'string' ? error.body : error.body?.detail}
            </Flexbox>
          )}
        </Flexbox>
      }
    >
      <Tag color={'error'} variant={'filled'}>
        {t('FileParsingStatus.chunks.status.error')}{' '}
        <Icon icon={RotateCwIcon} title={t('retry', { ns: 'common' })} onClick={onRetry} />
      </Tag>
    </Tooltip>
  );
});

export default ChunkingErrorTag;
