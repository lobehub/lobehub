import type { TaskTemplate } from '@lobechat/const';
import { ActionIcon, Block, Button, Center, Flexbox, Tag, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar, cx } from 'antd-style';
import { Clock, X } from 'lucide-react';
import { memo, type MouseEvent, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import BriefCardSummary from '@/features/DailyBrief/BriefCardSummary';
import { styles as briefStyles } from '@/features/DailyBrief/style';

import { resolveTemplateIcon } from './resolveTemplateIcon';
import { SkillAuthRow } from './SkillAuthRow';
import { styles } from './style';
import { createTaskTemplateDetailModal } from './TaskTemplateDetailModal';
import { INTEREST_ICON_MAP, TemplateBriefIcon } from './TemplateBriefIcon';
import { useScheduleText } from './useScheduleText';
import { useTaskTemplateCreate } from './useTaskTemplateCreate';
import { useVisibleAuthSpecs } from './useVisibleAuthSpecs';

interface TaskTemplateCardProps {
  onCreated: (templateId: string) => void;
  onDismiss: (templateId: string) => void;
  template: TaskTemplate;
}

export const TaskTemplateCard = memo<TaskTemplateCardProps>(
  ({ template, onCreated, onDismiss }) => {
    const { t } = useTranslation('taskTemplate');

    const iconSpec = useMemo(() => resolveTemplateIcon(template, INTEREST_ICON_MAP), [template]);
    const visibleAuthSpecs = useVisibleAuthSpecs(template, { hideMainIconProvider: true });
    const title = t(`${template.id}.title`, { defaultValue: '' });
    const description = t(`${template.id}.description`, { defaultValue: '' });

    const {
      created,
      disabled,
      handleAddTask,
      handleConnectError,
      loading,
      pendingCreate,
      primaryButtonLabel,
    } = useTaskTemplateCreate({ description, onCreated, template, title });

    const scheduleText = useScheduleText(template.cronPattern);

    const handleDismiss = useCallback(
      (event: MouseEvent) => {
        event.stopPropagation();
        if (loading || created) return;
        onDismiss(template.id);
      },
      [created, loading, onDismiss, template.id],
    );

    const handleOpenDetail = useCallback(() => {
      createTaskTemplateDetailModal({ onCreated, template });
    }, [onCreated, template]);

    const handlePrimaryClick = useCallback(
      (event: MouseEvent) => {
        event.stopPropagation();
        handleAddTask();
      },
      [handleAddTask],
    );

    const primaryButton = (
      <Button
        shadow
        className={briefStyles.actionBtnPrimary}
        disabled={disabled}
        loading={loading || pendingCreate}
        shape={'round'}
        onClick={handlePrimaryClick}
      >
        {primaryButtonLabel}
      </Button>
    );

    return (
      <Block
        className={cx(briefStyles.card, styles.card)}
        gap={12}
        padding={12}
        style={{ borderRadius: cssVar.borderRadiusLG, cursor: 'pointer' }}
        variant={'outlined'}
        onClick={handleOpenDetail}
      >
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}
          >
            <TemplateBriefIcon spec={iconSpec} />
            <Flexbox
              horizontal
              align={'center'}
              flex={1}
              gap={6}
              style={{ minWidth: 0, overflow: 'hidden' }}
            >
              <Text ellipsis fontSize={16} weight={500}>
                {title}
              </Text>
              <ActionIcon
                icon={Clock}
                size={12}
                title={
                  <Center>
                    <span>{scheduleText}</span>
                    {t('schedule.editableAfterCreateTooltip')}
                  </Center>
                }
              />
            </Flexbox>
          </Flexbox>

          <Flexbox horizontal align={'center'} gap={8}>
            <ActionIcon
              className={`${styles.dismissBtn} task-template-dismiss`}
              icon={X}
              size={'small'}
              title={t('action.dismiss.tooltip')}
              onClick={handleDismiss}
            />
          </Flexbox>
        </Flexbox>
        <Divider dashed style={{ marginBlock: 0 }} />
        {description.trim().length > 0 ? <BriefCardSummary summary={description} /> : null}
        {visibleAuthSpecs.length > 0 && (
          <Flexbox gap={6} onClick={(e) => e.stopPropagation()}>
            {visibleAuthSpecs.map((spec) => (
              <SkillAuthRow
                key={`${spec.source}:${spec.provider}`}
                spec={spec}
                onError={handleConnectError}
              />
            ))}
          </Flexbox>
        )}
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Tag size={'small'} variant={'outlined'}>
              {t('card.templateTag')}
            </Tag>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8}>
            {primaryButton}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

TaskTemplateCard.displayName = 'TaskTemplateCard';
