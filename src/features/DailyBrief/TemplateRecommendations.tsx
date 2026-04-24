import { type BriefTemplate, type BriefTemplateCategory } from '@lobechat/const';
import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import {
  Briefcase,
  Code,
  GraduationCap,
  Lightbulb,
  type LucideIcon,
  Megaphone,
  Package,
  Palette,
  PenSquare,
  Sparkles,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import GroupBlock from '@/routes/(main)/home/features/components/GroupBlock';
import { INTEREST_AREAS } from '@/routes/onboarding/config';
import { agentCronJobService } from '@/services/agentCronJob';
import { briefTemplateService } from '@/services/briefTemplate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { recommendStyles, styles } from './style';

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

const ICON_BY_CATEGORY: Record<BriefTemplateCategory, LucideIcon> = {
  'business': Briefcase,
  'content-creation': PenSquare,
  'design': Palette,
  'engineering': Code,
  'learning-research': GraduationCap,
  'marketing': Megaphone,
  'personal-life': Sparkles,
  'product': Package,
};

interface TemplateCardProps {
  template: BriefTemplate;
}

const TemplateCard = memo<TemplateCardProps>(({ template }) => {
  const { t } = useTranslation('briefTemplate');
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(false);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  const IconComp = ICON_BY_CATEGORY[template.category] ?? Sparkles;
  // Dynamic key lookups: defaultValue forces t() into its string-returning overload.
  const title = t(`${template.id}.title`, { defaultValue: '' });
  const description = t(`${template.id}.description`, { defaultValue: '' });

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
        timezone: 'UTC',
      });
      setCreated(true);
      message.success(t('action.create.success'));
    } catch (error) {
      console.error('[briefTemplate:create]', error);
      message.error(t('action.create.error'));
    } finally {
      setLoading(false);
    }
  }, [inboxAgentId, message, t, template.cronPattern, template.id, title]);

  return (
    <Block
      horizontal
      className={styles.card}
      gap={12}
      padding={12}
      style={{ borderRadius: cssVar.borderRadiusLG }}
      variant={'outlined'}
    >
      <Flexbox align={'center'} className={recommendStyles.iconBadge} justify={'center'}>
        <Icon icon={IconComp} size={18} />
      </Flexbox>
      <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
        <Text ellipsis fontSize={14} weight={500}>
          {title}
        </Text>
        <Text fontSize={12} style={{ color: cssVar.colorTextDescription }}>
          {description}
        </Text>
      </Flexbox>
      <Button
        disabled={created || !inboxAgentId}
        loading={loading}
        size={'small'}
        type={created ? 'default' : 'primary'}
        onClick={handleCreate}
      >
        {loading ? t('action.creating') : t('action.createButton')}
      </Button>
    </Block>
  );
});

const TemplateRecommendations = memo(() => {
  const { t } = useTranslation('briefTemplate');
  const isLogin = useUserStore(authSelectors.isLogin);
  const { enableAgentTask } = useServerConfigStore(featureFlagsSelectors);
  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  useFetchBriefs(isLogin && !!enableAgentTask);

  const briefs = useBriefStore(briefListSelectors.briefs);
  const isInit = useBriefStore(briefListSelectors.isBriefsInit);

  const interestKeys = useResolvedInterestKeys();
  const swrKey = [...interestKeys].sort().join(',');

  const enabled = isLogin && !!enableAgentTask && isInit && briefs.length <= RECOMMEND_THRESHOLD;

  const { data, isLoading } = useSWR(
    enabled ? ['briefTemplate.listDailyRecommend', swrKey] : null,
    async () => briefTemplateService.listDailyRecommend(interestKeys),
  );

  if (!enabled || isLoading) return null;
  const templates = data?.data ?? [];
  if (templates.length === 0) return null;

  return (
    <GroupBlock icon={Lightbulb} title={t('section.title')}>
      <Flexbox gap={8}>
        {templates.map((tmpl) => (
          <TemplateCard key={tmpl.id} template={tmpl} />
        ))}
      </Flexbox>
    </GroupBlock>
  );
});

export default TemplateRecommendations;
