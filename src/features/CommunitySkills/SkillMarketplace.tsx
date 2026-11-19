import { Button, Flexbox } from '@lobehub/ui';
import { ArrowLeft } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { CatalogBody } from '@/features/MarketplaceCatalog/CatalogBody';
import { catalogDetailQuery } from '@/features/MarketplaceCatalog/catalogDetailQuery';
import { CatalogHeader } from '@/features/MarketplaceCatalog/CatalogHeader';
import SkillDetail from '@/features/Settings/skill/features/SkillDetail';
import { parseMobileSelection } from '@/features/Settings/skill/mobileSelection';
import AddSkillButton from '@/features/SkillStore/SkillList/AddSkillButton';
import { useQuery } from '@/hooks/useQuery';
import { useSkillCategory } from '@/hooks/useSkillCategory';
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
  const [params, setParams] = useSearchParams();
  const query = useQuery() as SkillQueryParams;
  const categories = useSkillCategory();
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
  const back = () => setParams(catalogDetailQuery(params), { replace: true });
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
        action={signedIn && <AddSkillButton skillsOnly />}
        categories={categories}
        description={t('skills.marketplaceDescription')}
        searchLabel={t('skills.searchPlaceholder')}
        title={t('tab.skill')}
      />
      {signedIn && isMobileSurface() && (
        <details>
          <summary>{t('plugins.installed')}</summary>
          <InstalledSkills hideTitle />
        </details>
      )}
      <CatalogBody
        allLabel={t('skills.categories.all.description')}
        categories={<CategorySections />}
        categoryLabel={categories.find(({ key }) => key === query.category && key !== 'all')?.label}
        featured={<FeaturedSkills />}
        filtered={filtered}
        path="/community/skill"
        results={<SkillResults query={query} />}
        searching={Boolean(query.q)}
        sortControl={sortControl}
      />
    </Flexbox>
  );
};
