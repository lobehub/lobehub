import type { TaskTemplate } from '@lobechat/const';
import { formatScheduleTime, parseCronPattern, WEEKDAY_I18N_KEYS } from '@lobechat/utils/cron';
import { ActionIcon, Block, Button, Center, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { App, Divider } from 'antd';
import { cssVar, cx } from 'antd-style';
import { Clock, Link2, type LucideIcon, Sparkles, X } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BriefCardSummary from '@/features/DailyBrief/BriefCardSummary';
import { styles as briefStyles } from '@/features/DailyBrief/style';
import { INTEREST_AREAS } from '@/routes/onboarding/config';
import { agentCronJobService } from '@/services/agentCronJob';
import { taskTemplateService } from '@/services/taskTemplate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

import { styles } from './style';
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
  onDismiss: (templateId: string) => void;
  template: TaskTemplate;
}

export const TaskTemplateCard = memo<TaskTemplateCardProps>(({ template, onDismiss }) => {
  const { t } = useTranslation('taskTemplate');
  const { t: tSetting } = useTranslation('setting');
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(false);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  const skillConnection = useSkillConnection(template.requiresSkills);
  const optionalSkillConnection = useSkillConnection(template.optionalSkills);
  const showOptionalHint =
    !skillConnection.needsConnect &&
    optionalSkillConnection.needsConnect &&
    !!optionalSkillConnection.nextUnconnected;

  const IconComp = INTEREST_ICON_MAP.get(template.interests[0]) ?? Sparkles;
  const title = t(`${template.id}.title`, { defaultValue: '' });
  const description = t(`${template.id}.description`, { defaultValue: '' });

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
      await taskTemplateService.recordCreated(template.id).catch((recordError) => {
        console.error('[taskTemplate:recordCreated]', recordError);
      });
      setCreated(true);
      message.success(t('action.create.success'));
    } catch (error) {
      console.error('[taskTemplate:create]', error);
      message.error(t('action.create.error'));
    } finally {
      setLoading(false);
    }
  }, [inboxAgentId, message, t, template.cronPattern, template.id, title]);

  const handleDismiss = useCallback(() => {
    if (loading || created) return;
    onDismiss(template.id);
  }, [created, loading, onDismiss, template.id]);

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
    try {
      await skillConnection.connect();
    } catch (error) {
      handleConnectError(error);
    }
  }, [skillConnection, handleConnectError]);

  const handleConnectOptional = useCallback(async () => {
    try {
      await optionalSkillConnection.connect();
    } catch (error) {
      handleConnectError(error);
    }
  }, [optionalSkillConnection, handleConnectError]);

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
});

TaskTemplateCard.displayName = 'TaskTemplateCard';
