import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { CatalogHeader } from '@/features/MarketplaceCatalog/CatalogHeader';
import SkillDetail from '@/features/Settings/skill/features/SkillDetail';
import { parseMobileSelection } from '@/features/Settings/skill/mobileSelection';
import AddSkillButton from '@/features/SkillStore/SkillList/AddSkillButton';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useQuery } from '@/hooks/useQuery';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { type SkillQueryParams } from '@/types/discover';
import { isMobileSurface } from '@/utils/mobileSurface';

import { InstalledSkills } from './InstalledSkills';
import { CategorySections, FeaturedSkills, SkillResults } from './SkillCatalog';

export const SkillMarketplace = ({ sortControl }: { sortControl: ReactNode }) => {
  const { t } = useTranslation('discover');
  const [params] = useSearchParams();
  const query = useQuery() as SkillQueryParams;
  const navigate = useWorkspaceAwareNavigate();
  const signedIn = Boolean(useUserStore(authSelectors.isLogin));
  // The sidebar may be collapsed or unmounted (mobile detail/deep link).
  const useSkills = useToolStore((s) => s.useFetchAgentSkills);
  const useBuiltin = useToolStore((s) => s.useFetchUninstalledBuiltinTools);
  useSkills(signedIn);
  useBuiltin(signedIn);
  const legacy = useToolStore(
    agentSkillsSelectors.getAgentSkillByIdentifier(params.get('skill') ?? ''),
  );
  const selected =
    parseMobileSelection(params.get('open')) ??
    (legacy && { type: 'agent-skill' as const, identifier: legacy.id });
  const filtered = !!(query.q || query.category || query.page || query.sort);
  const back = () => navigate('/community/skill', { replace: true });
  if (selected && (selected.type === 'builtin-skill' || selected.type === 'agent-skill'))
    return (
      <Flexbox align="flex-start">
        <Button icon={ArrowLeft} type="text" onClick={back}>
          {t('tab.skill')}
        </Button>
        <Flexbox width="100%">
          <SkillDetail
            identifier={selected.identifier}
            key={selected.identifier}
            type={selected.type}
            onDelete={back}
          />
        </Flexbox>
      </Flexbox>
    );
  return (
    <Flexbox gap={24}>
      <CatalogHeader
        action={<AddSkillButton skillsOnly />}
        description={t('skills.marketplaceDescription')}
        searchLabel={t('skills.searchPlaceholder')}
        title={t('tab.skill')}
      />
      {signedIn && isMobileSurface() && (
        <details>
          <summary>{t('plugins.installed')}</summary>
          <InstalledSkills />
        </details>
      )}
      {filtered ? (
        <>
          <Flexbox horizontal align="center" gap={8} justify="space-between">
            <WorkspaceLink to="/community/skill">← {t('tab.skill')}</WorkspaceLink>
            {sortControl}
          </Flexbox>
          {query.category && (
            <Text as="h2" fontSize={18} weight={600}>
              {t(`skills.categories.${query.category}.name`, { defaultValue: query.category })}
            </Text>
          )}
          <SkillResults query={query} />
        </>
      ) : (
        <>
          <FeaturedSkills />
          <Flexbox horizontal align="center" gap={8} justify="space-between">
            <WorkspaceLink
              style={{ alignItems: 'center', display: 'inline-flex', gap: 4 }}
              to="/community/skill?category=all"
            >
              {t('skills.categories.all.description')}
              <Icon icon={ChevronRight} size={16} />
            </WorkspaceLink>
            {sortControl}
          </Flexbox>
          <CategorySections />
        </>
      )}
    </Flexbox>
  );
};
