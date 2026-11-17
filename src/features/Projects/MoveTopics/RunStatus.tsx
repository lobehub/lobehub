import { Alert, cssVar, Flexbox, Icon, Progress, Text } from '@lobehub/ui';
import { CircleCheck } from 'lucide-react';
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

export const RunResult = ({ result }: { result: AssociateTopicsResult }) => {
  const { t } = useTranslation('project');
  const counts = REASONS.map((reason) => ({
    count: result.skippedTopics.filter((topic) => topic.reason === reason).length,
    reason,
  })).filter((item) => item.count > 0);
  return (
    <Flexbox gap={12} paddingBlock={16}>
      <Flexbox horizontal align="center" gap={8}>
        <Icon color={cssVar.colorSuccess} icon={CircleCheck} size={20} />
        <Text weight={500}>{t('moveTopics.done', { count: result.movedTopicIds.length })}</Text>
      </Flexbox>
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
      {result.error ? (
        <Alert
          showIcon
          description={result.error instanceof Error ? result.error.message : undefined}
          title={t('moveTopics.failed')}
          type="error"
        />
      ) : null}
    </Flexbox>
  );
};
