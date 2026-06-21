import { Block, Icon, Text } from '@lobehub/ui';
import { cssVar, useThemeMode } from 'antd-style';
import { ShieldCheck } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useRubrics } from '@/features/Verify/hooks';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { openVerifyConfigModal } from './VerifyConfigModal';

const TaskVerifyConfig = memo(() => {
  const { t } = useTranslation('chat');
  const { allowed: canEditTask } = usePermission('create_content');
  const { isDarkMode } = useThemeMode();
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const verify = useTaskStore(taskDetailSelectors.activeTaskVerifyConfig);
  const { data: rubrics } = useRubrics();

  const rubricTitle = useMemo(
    () => rubrics?.find((r) => r.id === verify?.verifyRubricId)?.title,
    [rubrics, verify?.verifyRubricId],
  );

  if (!taskId) return null;

  const criteriaCount = verify?.verifyCriteriaIds?.length ?? 0;
  const isConfigured = !!verify?.verifyRubricId || criteriaCount > 0;
  const isDisabled = verify?.enabled === false;

  const handleClick = () => {
    if (!canEditTask) return;
    openVerifyConfigModal({ initial: verify, taskId });
  };

  const variant = isDarkMode ? 'filled' : 'outlined';

  let label: string;
  let color: string | undefined;
  if (isDisabled) {
    label = t('verifyConfig.disabled');
    color = cssVar.colorTextDescription;
  } else if (isConfigured) {
    label = rubricTitle || t('verifyConfig.criteriaCount', { count: criteriaCount });
  } else {
    label = t('verifyConfig.unconfigured');
    color = cssVar.colorTextDescription;
  }

  return (
    <Block
      horizontal
      align="center"
      clickable={canEditTask}
      gap={8}
      paddingBlock={4}
      paddingInline={11}
      style={{
        cursor: canEditTask ? 'pointer' : 'default',
        minHeight: 32,
        opacity: canEditTask ? 1 : 0.6,
      }}
      variant={variant}
      onClick={handleClick}
    >
      <Icon color={color ?? cssVar.colorTextSecondary} icon={ShieldCheck} size={18} />
      <Text style={{ color }} weight={500}>
        {label}
      </Text>
      {isConfigured && !isDisabled && rubricTitle && criteriaCount > 0 ? (
        <Text style={{ color: cssVar.colorTextDescription }}>
          {t('verifyConfig.criteriaCount', { count: criteriaCount })}
        </Text>
      ) : null}
    </Block>
  );
});

export default TaskVerifyConfig;
