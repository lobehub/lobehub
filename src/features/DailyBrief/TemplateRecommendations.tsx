import { type BriefTemplate, type BriefTemplateCategory } from '@lobechat/const';
import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { App, Divider } from 'antd';
import { cssVar } from 'antd-style';
import {
  Briefcase,
  Code,
  GraduationCap,
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

import { INTEREST_AREAS } from '@/routes/onboarding/config';
import { briefTemplateService } from '@/services/briefTemplate';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { recommendStyles, styles } from './style';

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
  const { i18n } = useTranslation('onboarding');

  return useMemo(() => {
    const labelToKey = new Map<string, string>();
    for (const area of INTEREST_AREAS) {
      labelToKey.set(area.key, area.key);
      const translated = i18n.t(`interests.area.${area.key}`, {
        defaultValue: '',
        ns: 'onboarding',
      });
      if (translated) labelToKey.set(translated.trim().toLowerCase(), area.key);
    }
    return userInterests.map((raw) => {
      const k = raw.trim().toLowerCase();
      return labelToKey.get(k) ?? k;
    });
  }, [userInterests, i18n.language, i18n]);
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

  const IconComp = ICON_BY_CATEGORY[template.category] ?? Sparkles;
  // Dynamic key lookups: defaultValue forces t() into its string-returning overload.
  const title = t(`${template.id}.title`, { defaultValue: '' });
  const description = t(`${template.id}.description`, { defaultValue: '' });

  const handleCreate = useCallback(async () => {
    setLoading(true);
    try {
      const prompt = t(`${template.id}.prompt`, { defaultValue: '' });
      await briefTemplateService.createFromTemplate({
        prompt,
        templateId: template.id,
        title,
      });
      setCreated(true);
      message.success(t('action.create.success'));
    } catch (error) {
      console.error('[briefTemplate:create]', error);
      message.error(t('action.create.error'));
    } finally {
      setLoading(false);
    }
  }, [message, t, template.id, title]);

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
        disabled={created}
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

const TemplateRecommendations = memo<{ enabled: boolean }>(({ enabled }) => {
  const { t } = useTranslation('briefTemplate');
  const interestKeys = useResolvedInterestKeys();
  const swrKey = [...interestKeys].sort().join(',');

  const { data, isLoading } = useSWR(
    enabled ? ['briefTemplate.listDailyRecommend', swrKey] : null,
    async () => briefTemplateService.listDailyRecommend(interestKeys),
  );

  const templates = data?.data ?? [];
  if (isLoading || templates.length === 0) return null;

  return (
    <Flexbox gap={12}>
      <Divider style={{ margin: '4px 0' }} />
      <Text fontSize={14} weight={600}>
        {t('section.title')}
      </Text>
      <Text fontSize={12} style={{ color: cssVar.colorTextDescription }}>
        {t('section.description')}
      </Text>
      <Flexbox gap={8}>
        {templates.map((tmpl) => (
          <TemplateCard key={tmpl.id} template={tmpl} />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

export default TemplateRecommendations;
