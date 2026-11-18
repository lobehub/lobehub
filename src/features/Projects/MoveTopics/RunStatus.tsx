import { Alert, Button, cssVar, Flexbox, Icon, Progress, Text } from '@lobehub/ui';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type AssociateTopicsProgress,
  type AssociateTopicsResult,
  type SkippedProjectTopic,
} from '@/store/projectWorkingDirectory';

const REASONS: SkippedProjectTopic['reason'][] = [
  'needsDirectory',
  'otherProject',
  'running',
  'differentLocation',
  'notFound',
];

export const RunProgress = ({ progress }: { progress: AssociateTopicsProgress }) => {
  const { t } = useTranslation('project');
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <Flexbox gap={8} paddingBlock={24}>
      <Text>{t('moveTopics.progress', { done: progress.done, total: progress.total })}</Text>
      <Progress percent={percent} showInfo={false} />
    </Flexbox>
  );
};

/** One readable line for a failed run; the raw message only on demand. */
const RunError = ({ error, partial }: { error: unknown; partial: boolean }) => {
  const { t } = useTranslation('project');
  const [showDetails, setShowDetails] = useState(false);
  const message = error instanceof Error ? error.message : undefined;
  return (
    <Flexbox gap={4}>
      <Flexbox horizontal align="center" gap={8}>
        <Icon color={cssVar.colorError} icon={CircleAlert} size={16} />
        <Text type="danger">
          {partial ? t('moveTopics.failedPartial') : t('moveTopics.failedNone')}
        </Text>
        {message && (
          <Button size="small" type="link" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? t('moveTopics.hideDetails') : t('moveTopics.showDetails')}
          </Button>
        )}
      </Flexbox>
      {showDetails && message && (
        <Text fontSize={12} style={{ paddingInlineStart: 24 }} type="secondary">
          {message}
        </Text>
      )}
    </Flexbox>
  );
};

export const RunResult = ({ result }: { result: AssociateTopicsResult }) => {
  const { t } = useTranslation('project');
  const moved = result.movedTopicIds.length;
  const counts = REASONS.map((reason) => ({
    count: result.skippedTopics.filter((topic) => topic.reason === reason).length,
    reason,
  })).filter((item) => item.count > 0);
  return (
    <Flexbox gap={12} paddingBlock={16}>
      {(moved > 0 || !result.error) && (
        <Flexbox horizontal align="center" gap={8}>
          <Icon color={cssVar.colorSuccess} icon={CircleCheck} size={20} />
          <Text weight={500}>{t('moveTopics.done', { count: moved })}</Text>
        </Flexbox>
      )}
      {result.error ? <RunError error={result.error} partial={moved > 0} /> : null}
      {counts.length > 0 && (
        <Alert
          showIcon
          title={t('moveTopics.skipped', { count: result.skippedTopics.length })}
          type="warning"
          description={
            <Flexbox gap={4}>
              {counts.map(({ count, reason }) => (
                <Text fontSize={12} key={reason}>
                  {t(`moveTopics.skipReason.${reason}`, { count })}
                </Text>
              ))}
            </Flexbox>
          }
        />
      )}
    </Flexbox>
  );
};
