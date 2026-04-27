import {
  type TaskTemplate,
  type TaskTemplateCategory,
  type TaskTemplateSkillSource,
} from '@lobechat/const';
import { formatScheduleTime, parseCronPattern, WEEKDAY_I18N_KEYS } from '@lobechat/utils/cron';
import { ActionIcon, Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import {
  Briefcase,
  Clock,
  Code,
  GraduationCap,
  Lightbulb,
  type LucideIcon,
  Megaphone,
  Package,
  Palette,
  PenSquare,
  Sparkles,
  X,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useSkillConnection } from '@/hooks/useSkillConnection';
import GroupBlock from '@/routes/(main)/home/features/components/GroupBlock';
import { INTEREST_AREAS } from '@/routes/onboarding/config';
import { agentCronJobService } from '@/services/agentCronJob';
import { taskTemplateService } from '@/services/taskTemplate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { styles } from './style';

const RECOMMEND_THRESHOLD = 1;

/**
 * onboarding stores localized labels in `user.interests` (e.g. "内容创作",
 * "Content Creation") plus occasional freeform text. Resolve each entry back
 * to an INTEREST_AREAS key via the current-locale onboarding translations so
 * the server can intersection-match against template.interests (which hold
 * canonical keys). Unresolved entries are lowercased passthroughs — server
 * treats them as non-matching.
 */
const useResolvedInterestKeys = (): string[] => {
  const userInterests = useUserStore(userProfileSelectors.interests);
  const { t } = useTranslation('onboarding');

  return useMemo(() => {
    const labelToKey = new Map<string, string>();
    for (const area of INTEREST_AREAS) {
      labelToKey.set(area.key, area.key);
      const translated = t(`interests.area.${area.key}`, { defaultValue: '' });
      if (translated) labelToKey.set(translated.trim().toLowerCase(), area.key);
    }
    return userInterests.map((raw) => {
      const k = raw.trim().toLowerCase();
      return labelToKey.get(k) ?? k;
    });
  }, [userInterests, t]);
};

const ICON_BY_CATEGORY: Record<TaskTemplateCategory, LucideIcon> = {
  'business': Briefcase,
  'content-creation': PenSquare,
  'design': Palette,
  'engineering': Code,
  'learning-research': GraduationCap,
  'marketing': Megaphone,
  'personal-life': Sparkles,
  'product': Package,
};

interface TaskTemplateCardProps {
  onDismiss: (templateId: string) => void;
  template: TaskTemplate;
}

const TaskTemplateCard = memo<TaskTemplateCardProps>(({ template, onDismiss }) => {
  const { t } = useTranslation('taskTemplate');
  const { t: tSetting } = useTranslation('setting');
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(false);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  const skillConnection = useSkillConnection(template.requiresSkills);

  const IconComp = template.icon ?? ICON_BY_CATEGORY[template.category] ?? Sparkles;
  // Dynamic key lookups: defaultValue forces t() into its string-returning overload.
  const title = t(`${template.id}.title`, { defaultValue: '' });
  const description = t(`${template.id}.description`, { defaultValue: '' });

  const scheduleText = useMemo(() => {
    const parsed = parseCronPattern(template.cronPattern);
    const time = formatScheduleTime(parsed.triggerHour, parsed.triggerMinute);
    if (parsed.scheduleType === 'weekly' && parsed.weekdays?.length === 1) {
      const weekday = tSetting(`agentCronJobs.weekday.${WEEKDAY_I18N_KEYS[parsed.weekdays[0]]}`);
      return t('schedule.weekly', { time, weekday });
    }
    // Catalog ships only daily + single-weekday weekly today; multi-day or
    // hourly templates would land here and need richer copy when added.
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
        timezone: 'UTC',
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

  return (
    <Block
      horizontal
      align={'center'}
      className={styles.card}
      gap={12}
      padding={12}
      style={{ borderRadius: cssVar.borderRadiusLG }}
      variant={'outlined'}
    >
      <Flexbox align={'center'} className={styles.iconBadge} justify={'center'}>
        <Icon icon={IconComp} size={18} />
      </Flexbox>
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        <Text ellipsis fontSize={14} weight={500}>
          {title}
        </Text>
        <Text fontSize={12} style={{ color: cssVar.colorTextDescription }}>
          {description}
        </Text>
        <Flexbox horizontal align={'center'} gap={4} style={{ color: cssVar.colorTextTertiary }}>
          <Icon icon={Clock} size={12} />
          <Text fontSize={12} style={{ color: 'inherit' }}>
            {scheduleText}
          </Text>
        </Flexbox>
      </Flexbox>
      {skillConnection.needsConnect && skillConnection.nextUnconnected ? (
        <Button
          loading={skillConnection.isConnecting}
          size={'small'}
          type={'primary'}
          onClick={skillConnection.connect}
        >
          {t('action.connect.button', { provider: skillConnection.nextUnconnected.label })}
        </Button>
      ) : (
        <Button
          disabled={created || !inboxAgentId}
          loading={loading}
          size={'small'}
          type={created ? 'default' : 'primary'}
          onClick={handleCreate}
        >
          {loading ? t('action.creating') : t('action.createButton')}
        </Button>
      )}
      <ActionIcon
        className={`${styles.dismissBtn} task-template-dismiss`}
        icon={X}
        size={'small'}
        title={t('action.dismiss.tooltip')}
        onClick={handleDismiss}
      />
    </Block>
  );
});

const TaskTemplates = memo(() => {
  const { t } = useTranslation('taskTemplate');
  const { message } = App.useApp();
  const isLogin = useUserStore(authSelectors.isLogin);
  const { enableAgentTask } = useServerConfigStore(featureFlagsSelectors);
  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  useFetchBriefs(isLogin && !!enableAgentTask);

  const briefs = useBriefStore(briefListSelectors.briefs);
  const isInit = useBriefStore(briefListSelectors.isBriefsInit);

  const interestKeys = useResolvedInterestKeys();
  const swrKey = [...interestKeys].sort().join(',');

  const enabled = isLogin && !!enableAgentTask && isInit && briefs.length <= RECOMMEND_THRESHOLD;

  const { data, isLoading, mutate } = useSWR(
    enabled ? ['taskTemplate.listDailyRecommend', swrKey] : null,
    async () => taskTemplateService.listDailyRecommend(interestKeys),
  );

  const handleDismiss = useCallback(
    async (templateId: string) => {
      // Optimistic remove — leave a gap until next refresh per LOBE-8187.
      mutate(
        (current) =>
          current ? { ...current, data: current.data.filter((t) => t.id !== templateId) } : current,
        false,
      );
      try {
        await taskTemplateService.dismiss(templateId);
      } catch (error) {
        console.error('[taskTemplate:dismiss]', error);
        message.error(t('action.dismiss.error'));
        // Revert by revalidating from server.
        mutate();
      }
    },
    [message, mutate, t],
  );

  // Pre-fetch skill stores only when the recommendation actually contains an
  // OAuth-dependent template — avoids unnecessary requests on the home page
  // for users who don't see any.
  const templates = useMemo(() => data?.data ?? [], [data]);
  const requiredSources = useMemo(() => {
    const sources = new Set<TaskTemplateSkillSource>();
    for (const tmpl of templates) {
      if (!tmpl.requiresSkills) continue;
      for (const s of tmpl.requiresSkills) sources.add(s.source);
    }
    return sources;
  }, [templates]);
  const useFetchUserKlavisServers = useToolStore((s) => s.useFetchUserKlavisServers);
  const useFetchLobehubSkillConnections = useToolStore((s) => s.useFetchLobehubSkillConnections);
  useFetchUserKlavisServers(requiredSources.has('klavis'));
  useFetchLobehubSkillConnections(requiredSources.has('lobehub'));

  if (!enabled || isLoading) return null;
  if (templates.length === 0) return null;

  return (
    <GroupBlock icon={Lightbulb} title={t('section.title')}>
      <Flexbox gap={8}>
        {templates.map((tmpl) => (
          <TaskTemplateCard key={tmpl.id} template={tmpl} onDismiss={handleDismiss} />
        ))}
      </Flexbox>
    </GroupBlock>
  );
});

export default TaskTemplates;
