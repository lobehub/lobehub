'use client';

import type {
  AgentTemplate,
  MarketplaceCategory,
} from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import { getTemplatesByCategoryPriority } from '@lobechat/builtin-tool-web-onboarding/agentMarketplace';
import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Undo2Icon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { useOnboardingAgentTemplates } from '@/hooks/useOnboardingAgentTemplates';
import { installMarketplaceAgents } from '@/services/installMarketplaceAgents';
import {
  trackOnboardingCompleted,
  trackOnboardingMarketplacePicked,
  trackOnboardingMarketplaceShown,
  trackOnboardingStepCompleted,
} from '@/services/onboardingMetrics';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { consumeOnboardingCallbackUrl } from '@/utils/onboardingRedirect';

import LobeMessage from '../../components/LobeMessage';
import { interestsToCategoryHints } from '../../interestCategoryMap';
import AgentCard from './AgentCard';
import CategoryFilter, { type ActiveCategory } from './CategoryFilter';
import AgentPickerSkeleton from './Skeleton';
import { styles } from './style';

interface AgentPickerStepProps {
  onBack: () => void;
}

const EMPTY_TEMPLATES: AgentTemplate[] = [];

const AgentPickerStep = memo<AgentPickerStepProps>(({ onBack }) => {
  const { t } = useTranslation('onboarding');
  const { t: tTool } = useTranslation('tool');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isAgentSkipEntry = searchParams.get('entry') === 'skip';
  const showBack = !isAgentSkipEntry;
  const completionFlow = isAgentSkipEntry ? 'agent' : 'classic';

  const finishOnboarding = useUserStore((s) => s.finishOnboarding);
  const interests = useUserStore(userProfileSelectors.interests);

  const categoryHints = useMemo(() => interestsToCategoryHints(interests), [interests]);
  const [requestId] = useState(() => Math.random().toString(36).slice(2));

  const { data: allTemplates = EMPTY_TEMPLATES, error, isLoading } = useOnboardingAgentTemplates();

  const orderedTemplates = useMemo(
    () => getTemplatesByCategoryPriority(allTemplates, categoryHints),
    [allTemplates, categoryHints],
  );

  const availableCategories = useMemo(() => {
    const seen = new Set<MarketplaceCategory>();
    const result: MarketplaceCategory[] = [];
    for (const tpl of orderedTemplates) {
      if (seen.has(tpl.category)) continue;
      seen.add(tpl.category);
      result.push(tpl.category);
    }
    return result;
  }, [orderedTemplates]);

  const [active, setActive] = useState<ActiveCategory>('all');
  const visibleTemplates = useMemo(
    () =>
      active === 'all'
        ? orderedTemplates
        : orderedTemplates.filter((tpl) => tpl.category === active),
    [active, orderedTemplates],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const [pending, setPending] = useState<'continue' | 'skip'>();
  const pendingRef = useRef(false);

  const shownRef = useRef(false);
  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    trackOnboardingMarketplaceShown({ categoryHints, requestId });
  }, [categoryHints, requestId]);

  const finish = useCallback(
    async (action: 'continue' | 'skip', selectedCount: number) => {
      await finishOnboarding();
      trackOnboardingStepCompleted({
        action,
        entry: isAgentSkipEntry ? 'agent_skip' : 'classic',
        flow: completionFlow,
        selectedCount,
        step: 'agentpicker',
        stepIndex: 4,
      });
      // Restore the original signup target (threaded through onboarding), if any
      const targetUrl = consumeOnboardingCallbackUrl() || '/';
      trackOnboardingCompleted({ flow: completionFlow, targetUrl });
      navigate(targetUrl);
    },
    [completionFlow, finishOnboarding, isAgentSkipEntry, navigate],
  );

  const handleSkip = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending('skip');
    await finish('skip', 0);
  }, [finish]);

  const handleContinue = useCallback(async () => {
    if (pendingRef.current || selected.size === 0) return;
    pendingRef.current = true;
    setPending('continue');

    const selectedTemplateIds = [...selected];
    trackOnboardingMarketplacePicked({ categoryHints, requestId, selectedTemplateIds });
    try {
      await installMarketplaceAgents(selectedTemplateIds);
    } catch (installError) {
      console.error('[AgentPickerStep] install failed', installError);
    }
    await finish('continue', selectedTemplateIds.length);
  }, [categoryHints, finish, requestId, selected]);

  const handleBack = useCallback(() => {
    if (pendingRef.current) return;
    onBack();
  }, [onBack]);

  const showLoading = isLoading && allTemplates.length === 0;
  const showEmpty = !isLoading && visibleTemplates.length === 0;

  return (
    <Flexbox gap={16}>
      <LobeMessage
        sentences={[t('agentPicker.title'), t('agentPicker.title2'), t('agentPicker.title3')]}
      />
      <Text fontSize={14} type={'secondary'}>
        {t('agentPicker.subtitle')}
      </Text>

      {showLoading ? (
        <AgentPickerSkeleton />
      ) : showEmpty ? (
        <div className={styles.empty}>
          {error
            ? tTool('agentMarketplace.picker.failedToLoad')
            : tTool('agentMarketplace.picker.empty')}
        </div>
      ) : (
        <>
          <CategoryFilter
            active={active}
            allLabel={t('agentPicker.allCategories')}
            categories={availableCategories}
            onChange={setActive}
          />
          <div className={styles.scrollArea}>
            <div className={styles.grid}>
              {visibleTemplates.map((tpl) => (
                <AgentCard
                  key={tpl.id}
                  selected={selected.has(tpl.id)}
                  template={tpl}
                  onToggle={toggle}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <div className={styles.footer}>
        {showBack ? (
          <Button
            disabled={!!pending}
            icon={Undo2Icon}
            style={{ color: cssVar.colorTextDescription }}
            type={'text'}
            onClick={handleBack}
          >
            {t('back')}
          </Button>
        ) : (
          <span />
        )}
        <div className={styles.footerActions}>
          <Button disabled={!!pending} type={'text'} onClick={() => void handleSkip()}>
            {t('agentPicker.skip')}
          </Button>
          <Button
            disabled={selected.size === 0 || pending === 'skip'}
            loading={pending === 'continue'}
            type={'primary'}
            onClick={() => void handleContinue()}
          >
            {`${t('agentPicker.continue')} (${selected.size})`}
          </Button>
        </div>
      </div>
    </Flexbox>
  );
});

AgentPickerStep.displayName = 'AgentPickerStep';

export default AgentPickerStep;
