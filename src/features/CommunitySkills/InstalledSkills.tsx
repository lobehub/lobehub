import { Flexbox, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { catalogDetailQuery } from '@/features/MarketplaceCatalog/catalogDetailQuery';
import AgentSkillItem from '@/features/Settings/skill/features/AgentSkillItem';
import { encodeMobileSelection } from '@/features/Settings/skill/mobileSelection';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors, builtinToolSelectors } from '@/store/tool/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const InstalledSkills = ({ hideTitle = false }: { hideTitle?: boolean }) => {
  const { t } = useTranslation('discover');
  const navigate = useWorkspaceAwareNavigate();
  const [query] = useSearchParams();
  const signedIn = Boolean(useUserStore(authSelectors.isLogin));
  const skills = useToolStore(agentSkillsSelectors.getAgentSkills, isEqual);
  const builtin = useToolStore(builtinToolSelectors.installedBuiltinSkills, isEqual);
  const useSkills = useToolStore((s) => s.useFetchAgentSkills);
  const useBuiltin = useToolStore((s) => s.useFetchUninstalledBuiltinTools);
  const sync = useSkills(signedIn);
  const builtinSync = useBuiltin(signedIn);
  if (!signedIn) return null;
  return (
    <Flexbox gap={2} padding={8}>
      {!hideTitle && (
        <Text as="h2" fontSize={12} type="secondary">
          {t('plugins.installed')}
        </Text>
      )}
      {[...builtin, ...skills].map((skill) => {
        const value = encodeMobileSelection(
          'id' in skill
            ? { type: 'agent-skill', identifier: skill.id }
            : { type: 'builtin-skill', identifier: skill.identifier },
        );
        return (
          <AgentSkillItem
            isSelected={query.get('open') === value}
            key={value}
            skill={skill}
            onSelect={() => navigate('/community/skill?' + catalogDetailQuery(query, value))}
          />
        );
      })}
      {sync.error || builtinSync.error ? (
        <AsyncError
          error={sync.error ?? builtinSync.error}
          onRetry={() => {
            void sync.revalidate();
            void builtinSync.revalidate();
          }}
        />
      ) : (
        !sync.isLoading &&
        builtinSync.isHydrated &&
        !builtinSync.isValidating &&
        !builtin.length &&
        !skills.length && <Text type="secondary">{t('skills.noneInstalled')}</Text>
      )}
    </Flexbox>
  );
};
