import type { RecommendedTaskTemplate } from '@lobechat/const';
import { formatScheduleTime, parseCronPattern, WEEKDAY_I18N_KEYS } from '@lobechat/utils/cron';
import { useAnalytics } from '@lobehub/analytics/react';
import { ActionIcon, Block, Button, Center, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { App, Divider } from 'antd';
import { cssVar, cx } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { Clock, Link2, Sparkles, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BriefCardSummary from '@/features/DailyBrief/BriefCardSummary';
import { styles as briefStyles } from '@/features/DailyBrief/style';
import { INTEREST_AREAS } from '@/routes/onboarding/config';
import { agentCronJobService } from '@/services/agentCronJob';
import { taskTemplateService } from '@/services/taskTemplate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';

import {
  getTaskTemplateCardStateProperties,
  getTaskTemplateCommonAnalyticsProperties,
  getTaskTemplateImpressionStorageKey,
  hasTrackedTaskTemplateImpression,
  markTaskTemplateImpressionTracked,
  resolveTaskTemplateErrorType,
} from './analytics';
import { styles } from './style';
import type { SkillConnectionResult } from './useSkillConnection';
import { SkillConnectionPopupBlockedError, useSkillConnection } from './useSkillConnection';

const INTEREST_ICON_MAP = new Map<string, LucideIcon>(INTEREST_AREAS.map((a) => [a.key, a.icon]));

interface TemplateBriefIconProps {
  icon: LucideIcon;
}

/** Same 28×28 tile treatment as {@link BriefIcon} (insight palette). */
const TemplateBriefIcon = memo<TemplateBriefIconProps>(({ icon }) => (
  <Block
    align={'center'}
    height={28}
    justify={'center'}
    style={{ background: cssVar.colorFillSecondary, flexShrink: 0 }}
    width={28}
  >
    <Icon color={cssVar.colorTextSecondary} icon={icon} size={28 * 0.6} />
  </Block>
));

TemplateBriefIcon.displayName = 'TemplateBriefIcon';

interface TaskTemplateCardProps {
  onCreated: (templateId: string) => void;
  onDismiss: (templateId: string) => void;
  position: number;
  recommendationBatchId: string;
  template: RecommendedTaskTemplate;
  userInterestCount: number;
}

export const TaskTemplateCard = memo<TaskTemplateCardProps>(
  ({ onCreated, onDismiss, position, recommendationBatchId, template, userInterestCount }) => {
    const { t } = useTranslation('taskTemplate');
    const { t: tSetting } = useTranslation('setting');
    const { analytics } = useAnalytics();
    const { message } = App.useApp();
    const [loading, setLoading] = useState(false);
    const [created, setCreated] = useState(false);
    const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
    const userId = useUserStore((s) => s.user?.id);
    const cardRef = useRef<HTMLDivElement>(null);
    const impressedAtRef = useRef<number | undefined>(undefined);

    const analyticsContext = useMemo(
      () => ({ position, recommendationBatchId, template, userInterestCount }),
      [position, recommendationBatchId, template, userInterestCount],
    );

    const trackCardEvent = useCallback(
      (name: string, spm: string, properties: Record<string, unknown> = {}) => {
        void analytics?.track({
          name,
          properties: {
            ...getTaskTemplateCommonAnalyticsProperties(analyticsContext, spm),
            ...properties,
          },
        });
      },
      [analytics, analyticsContext],
    );

    const handleRequiredConnectResult = useCallback(
      (result: SkillConnectionResult) => {
        trackCardEvent(
          'task_template_skill_connect_result',
          'home.task_templates.skill_connect_result',
          {
            duration_ms: result.durationMs,
            requirement_type: 'required',
            result: result.result,
            skill_provider: result.provider,
            skill_source: result.source,
          },
        );
      },
      [trackCardEvent],
    );

    const handleOptionalConnectResult = useCallback(
      (result: SkillConnectionResult) => {
        trackCardEvent(
          'task_template_skill_connect_result',
          'home.task_templates.skill_connect_result',
          {
            duration_ms: result.durationMs,
            requirement_type: 'optional',
            result: result.result,
            skill_provider: result.provider,
            skill_source: result.source,
          },
        );
      },
      [trackCardEvent],
    );

    const skillConnection = useSkillConnection(template.requiresSkills, {
      onConnectResult: handleRequiredConnectResult,
    });
    const optionalSkillConnection = useSkillConnection(template.optionalSkills, {
      onConnectResult: handleOptionalConnectResult,
    });
    const showOptionalHint =
      !skillConnection.needsConnect &&
      optionalSkillConnection.needsConnect &&
      !!optionalSkillConnection.nextUnconnected;

    const IconComp = INTEREST_ICON_MAP.get(template.interests[0]) ?? Sparkles;
    const title = t(`${template.id}.title`, { defaultValue: '' });
    const description = t(`${template.id}.description`, { defaultValue: '' });

    const getCurrentCardStateProperties = useCallback(
      () =>
        getTaskTemplateCardStateProperties({
          missingRequiredSkill: skillConnection.nextUnconnected,
          showOptionalHint,
          template,
        }),
      [showOptionalHint, skillConnection.nextUnconnected, template],
    );

    const trackSkillConnectClicked = useCallback(
      (
        requirementType: 'optional' | 'required',
        target: Pick<SkillConnectionResult, 'provider' | 'source'> | undefined,
      ) => {
        if (!target) return;

        trackCardEvent(
          'task_template_skill_connect_clicked',
          'home.task_templates.skill_connect_clicked',
          {
            requirement_type: requirementType,
            skill_provider: target.provider,
            skill_source: target.source,
          },
        );
      },
      [trackCardEvent],
    );

    useEffect(() => {
      if (!analytics) return;

      const node = cardRef.current;
      if (!node) return;

      const storageKey = getTaskTemplateImpressionStorageKey({
        templateId: template.id,
        userId,
      });
      if (hasTrackedTaskTemplateImpression(storageKey)) return;

      const trackImpression = () => {
        if (hasTrackedTaskTemplateImpression(storageKey)) return;
        markTaskTemplateImpressionTracked(storageKey);
        impressedAtRef.current = Date.now();
        trackCardEvent(
          'task_template_card_impression',
          'home.task_templates.card_impression',
          getCurrentCardStateProperties(),
        );
      };

      if (typeof IntersectionObserver === 'undefined') {
        trackImpression();
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          trackImpression();
          observer.disconnect();
        },
        { threshold: 0.5 },
      );

      observer.observe(node);

      return () => observer.disconnect();
    }, [analytics, getCurrentCardStateProperties, template.id, trackCardEvent, userId]);

    const scheduleText = useMemo(() => {
      const parsed = parseCronPattern(template.cronPattern);
      const time = formatScheduleTime(parsed.triggerHour, parsed.triggerMinute);
      if (parsed.scheduleType === 'weekly' && parsed.weekdays?.length === 1) {
        const weekday = tSetting(`agentCronJobs.weekday.${WEEKDAY_I18N_KEYS[parsed.weekdays[0]]}`);
        return t('schedule.weekly', { time, weekday });
      }
      return t('schedule.daily', { time });
    }, [t, tSetting, template.cronPattern]);

    const handleCreate = useCallback(async () => {
      if (!inboxAgentId) return;
      const startedAt = Date.now();
      trackCardEvent('task_template_create_clicked', 'home.task_templates.create_clicked');
      setLoading(true);
      try {
        const prompt = t(`${template.id}.prompt`, { defaultValue: '' });
        await agentCronJobService.create({
          agentId: inboxAgentId,
          content: prompt,
          cronPattern: template.cronPattern,
          enabled: true,
          name: title,
          templateId: template.id,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        trackCardEvent('task_template_create_result', 'home.task_templates.create_result', {
          duration_ms: Date.now() - startedAt,
          error_type: null,
          result: 'success',
        });
        await taskTemplateService.recordCreated(template.id).catch((recordError) => {
          console.error('[taskTemplate:recordCreated]', recordError);
        });
        setCreated(true);
        onCreated(template.id);
        message.success(t('action.create.success'));
      } catch (error) {
        trackCardEvent('task_template_create_result', 'home.task_templates.create_result', {
          duration_ms: Date.now() - startedAt,
          error_type: resolveTaskTemplateErrorType(error),
          result: 'fail',
        });
        console.error('[taskTemplate:create]', error);
        message.error(t('action.create.error'));
      } finally {
        setLoading(false);
      }
    }, [
      inboxAgentId,
      message,
      onCreated,
      t,
      template.cronPattern,
      template.id,
      title,
      trackCardEvent,
    ]);

    const handleDismiss = useCallback(() => {
      if (loading || created) return;
      trackCardEvent('task_template_dismissed', 'home.task_templates.dismissed', {
        time_since_impression_ms: impressedAtRef.current
          ? Date.now() - impressedAtRef.current
          : null,
        was_impressed: !!impressedAtRef.current,
      });
      onDismiss(template.id);
    }, [created, loading, onDismiss, template.id, trackCardEvent]);

    const handleConnectError = useCallback(
      (error: unknown) => {
        message.error(
          error instanceof SkillConnectionPopupBlockedError
            ? t('action.connect.popupBlocked')
            : t('action.connect.error'),
        );
      },
      [message, t],
    );

    const handleConnectRequired = useCallback(async () => {
      trackSkillConnectClicked('required', skillConnection.nextUnconnected);
      try {
        await skillConnection.connect();
      } catch (error) {
        handleConnectError(error);
      }
    }, [handleConnectError, skillConnection, trackSkillConnectClicked]);

    const handleConnectOptional = useCallback(async () => {
      trackSkillConnectClicked('optional', optionalSkillConnection.nextUnconnected);
      try {
        await optionalSkillConnection.connect();
      } catch (error) {
        handleConnectError(error);
      }
    }, [handleConnectError, optionalSkillConnection, trackSkillConnectClicked]);

    const primaryButton =
      skillConnection.needsConnect && skillConnection.nextUnconnected ? (
        <Button
          className={briefStyles.actionBtnPrimary}
          loading={skillConnection.isConnecting}
          shape={'round'}
          variant={'filled'}
          onClick={handleConnectRequired}
        >
          {t('action.connect.button', { provider: skillConnection.nextUnconnected.label })}
        </Button>
      ) : (
        <Button
          shadow
          className={briefStyles.actionBtnPrimary}
          disabled={created || !inboxAgentId}
          loading={loading}
          shape={'round'}
          onClick={handleCreate}
        >
          {loading ? t('action.creating') : t('action.createButton')}
        </Button>
      );

    const hintNode = showOptionalHint && optionalSkillConnection.nextUnconnected && (
      <button
        className={`${styles.meta} ${styles.optionalHintBtn}`}
        type={'button'}
        onClick={handleConnectOptional}
      >
        <Icon icon={Link2} size={12} />
        <Text fontSize={12} style={{ color: 'inherit' }}>
          {t('action.optionalConnect.button', {
            provider: optionalSkillConnection.nextUnconnected.label,
          })}
        </Text>
      </button>
    );

    return (
      <Block
        className={cx(briefStyles.card, styles.card)}
        gap={12}
        padding={12}
        ref={cardRef}
        style={{ borderRadius: cssVar.borderRadiusLG }}
        variant={'outlined'}
      >
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}
          >
            <TemplateBriefIcon icon={IconComp} />
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
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Tag size={'small'} variant={'outlined'}>
              {t('card.templateTag')}
            </Tag>
            {hintNode}
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
