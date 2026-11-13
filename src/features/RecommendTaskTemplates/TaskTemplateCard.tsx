import type { TaskTemplate } from '@lobechat/const';
import {
  ActionIcon,
  Block,
  Button,
  Center,
  cssVar,
  cx,
  Divider,
  Flexbox,
  Tag,
  Text,
} from '@lobehub/ui';
import { Clock, X } from 'lucide-react';
import { memo, type MouseEvent, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import BriefCardSummary from '@/features/DailyBrief/BriefCardSummary';
import { styles as briefStyles } from '@/features/DailyBrief/style';
import { homeType } from '@/features/Home/components/homeType';
import { RECOMMENDATION_ICON_SIZE } from '@/features/Recommendations/iconSize';

import { ConnectorAuthRow } from './ConnectorAuthRow';
import { isNestedControlClick } from './isNestedControlClick';
import { resolveTemplateIcon } from './resolveTemplateIcon';
import { styles } from './style';
import { INTEREST_ICON_MAP, TemplateBriefIcon } from './TemplateBriefIcon';
import { useScheduleText } from './useScheduleText';
import { useTaskTemplateCreate } from './useTaskTemplateCreate';
import { useVisibleAuthSpecs } from './useVisibleAuthSpecs';

interface TaskTemplateCardProps {
  /** A click on the card creates the task instead of opening the detail modal. */
  clickToCreate?: boolean;
  /** Rail rendering: one scannable line per suggestion, detail lives in the modal. */
  compact?: boolean;
  onCreated: (templateId: number) => void;
  /** Omit to hide the dismiss button. */
  onDismiss?: (templateId: number) => void;
  template: TaskTemplate;
}

export const TaskTemplateCard = memo<TaskTemplateCardProps>(
  ({ clickToCreate, compact, template, onCreated, onDismiss }) => {
    const { t } = useTranslation('common');

    const iconSpec = useMemo(() => resolveTemplateIcon(template, INTEREST_ICON_MAP), [template]);
    const visibleAuthSpecs = useVisibleAuthSpecs(template, { hideMainIconProvider: true });
    const title = template.title;
    const description = template.description;

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
        onDismiss?.(template.id);
      },
      [created, loading, onDismiss, template.id],
    );

    const handleOpenDetail = useCallback(() => {
      void import('./TaskTemplateDetailModal').then(({ createTaskTemplateDetailModal }) =>
        createTaskTemplateDetailModal({ onCreated, template }),
      );
    }, [onCreated, template]);

    const handlePrimaryClick = useCallback(
      (event: MouseEvent) => {
        event.stopPropagation();
        // The card body stays clickable while a create is in flight (`clickToCreate`).
        if (loading || pendingCreate) return;
        handleAddTask();
      },
      [handleAddTask, loading, pendingCreate],
    );

    // On `clickToCreate` the card body is the create action, but its own controls
    // keep their meaning: tapping the schedule info icon must only show its tooltip.
    const handleCardCreateClick = useCallback(
      (event: MouseEvent<HTMLElement>) => {
        if (isNestedControlClick(event.target, event.currentTarget)) return;
        handlePrimaryClick(event);
      },
      [handlePrimaryClick],
    );

    if (compact)
      return (
        <Flexbox horizontal align={'center'} className={styles.compactRow} gap={4}>
          <Button
            className={styles.compactMain}
            disabled={loading || pendingCreate}
            type={'text'}
            onClick={handleOpenDetail}
          >
            <Flexbox horizontal align={'flex-start'} gap={10} style={{ width: '100%' }}>
              <Flexbox flex={'none'} paddingBlock={2}>
                <TemplateBriefIcon spec={iconSpec} tileSize={RECOMMENDATION_ICON_SIZE.compact} />
              </Flexbox>
              <Text
                className={cx(homeType.itemTitleProse, styles.compactTitle)}
                style={{ flex: 1 }}
              >
                {title}
              </Text>
            </Flexbox>
          </Button>
          {onDismiss && (
            <ActionIcon
              className={`${styles.dismissBtn} task-template-dismiss`}
              icon={X}
              size={'small'}
              title={t('taskTemplate.action.dismiss.tooltip')}
              onClick={handleDismiss}
            />
          )}
        </Flexbox>
      );

    const primaryButton = (
      <Button
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
        onClick={clickToCreate ? handleCardCreateClick : handleOpenDetail}
      >
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}
          >
            <TemplateBriefIcon spec={iconSpec} tileSize={RECOMMENDATION_ICON_SIZE.regular} />
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
                    {t('taskTemplate.schedule.editableAfterCreateTooltip')}
                  </Center>
                }
              />
            </Flexbox>
          </Flexbox>

          {onDismiss && (
            <Flexbox horizontal align={'center'} gap={8}>
              <ActionIcon
                className={`${styles.dismissBtn} task-template-dismiss`}
                icon={X}
                size={'small'}
                title={t('taskTemplate.action.dismiss.tooltip')}
                onClick={handleDismiss}
              />
            </Flexbox>
          )}
        </Flexbox>
        <Divider dashed />
        {description.trim().length > 0 ? <BriefCardSummary summary={description} /> : null}
        {visibleAuthSpecs.length > 0 && (
          <Flexbox gap={6} onClick={(e) => e.stopPropagation()}>
            {visibleAuthSpecs.map((spec) => (
              <ConnectorAuthRow
                disabled={disabled}
                key={`${spec.source}:${spec.identifier}`}
                spec={spec}
                onError={handleConnectError}
              />
            ))}
          </Flexbox>
        )}
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Tag size={'small'} variant={'outlined'}>
              {t('taskTemplate.card.templateTag')}
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
