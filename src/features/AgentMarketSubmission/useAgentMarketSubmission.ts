import { getActivePluginIds, type LobeAgentConfig } from '@lobechat/types';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaClient } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

interface Options {
  agentId?: string | null;
  canSubmit: boolean;
  getPrompt: () => Pick<LobeAgentConfig, 'editorData' | 'systemRole'>;
}

/** Submit a snapshot for Market review; never call the manual publish endpoint. */
export const useAgentMarketSubmission = ({ agentId, canSubmit, getPrompt }: Options) => {
  const { i18n, t } = useTranslation('setting');
  const { isAuthenticated, signIn } = useMarketAuth();
  const hasActiveWorkspace = useHasActiveWorkspace();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [submittedAgentId, setSubmittedAgentId] = useState<string>();
  const busy = useRef(false);
  const modal = useRef<ReturnType<typeof confirmModal> | null>(null);

  useEffect(() => () => modal.current?.close(), [agentId, canSubmit]);

  const open = async () => {
    if (!canSubmit || !agentId || busy.current) return;
    const state = useAgentStore.getState();
    const config = agentSelectors.getAgentConfigById(agentId)(state);
    const meta = agentSelectors.getAgentMetaById(agentId)(state);
    if (!config) return;

    // Read before any await: changing routes during authorization must not submit
    // another agent's prompt or write the Market identifier onto that agent.
    const prompt = getPrompt();
    const snapshot = structuredClone({ ...config, ...prompt });
    const name = meta.title?.trim();
    if (!name || !snapshot.systemRole?.trim()) {
      toast.error(t('marketSubmission.required'));
      return;
    }

    busy.current = true;
    try {
      if (!isAuthenticated && !(await signIn())) return;
      if (useAgentStore.getState().activeAgentId !== agentId) return;
      modal.current?.close();
      modal.current = confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('marketSubmission.confirm', { name: meta.title }),
        okText: t('marketSubmission.submit'),
        onOk: async () => {
          if (busy.current) return;
          busy.current = true;
          setIsSubmitting(true);
          try {
            const actAs = hasActiveWorkspace
              ? (
                  await lambdaClient.workspace.ensureMarketOrganization.mutate({
                    autoProvision: true,
                  })
                ).marketAccountId
              : undefined;
            const result = await lambdaClient.market.agent.publishOrCreate.mutate({
              actAs,
              avatar: meta.avatar,
              config: {
                chatConfig: {
                  enableHistoryCount: snapshot.chatConfig?.enableHistoryCount,
                  historyCount: snapshot.chatConfig?.historyCount,
                  maxTokens: snapshot.params?.max_tokens,
                  searchMode: snapshot.chatConfig?.searchMode,
                  temperature: snapshot.params?.temperature,
                  topP: snapshot.params?.top_p,
                },
                description: meta.description,
                locale: i18n.resolvedLanguage || i18n.language,
                model: {
                  model: snapshot.model,
                  parameters: snapshot.params,
                  provider: snapshot.provider,
                },
                plugins: getActivePluginIds(snapshot.plugins),
                systemRole: snapshot.systemRole,
              },
              description: meta.description || '',
              editorData: snapshot.editorData,
              identifier: meta.marketIdentifier,
              name,
              tags: meta.tags,
            });

            if (result.isNewAgent) {
              try {
                await useAgentStore.getState().updateAgentMetaById(agentId, {
                  marketIdentifier: result.identifier,
                });
              } catch (error) {
                console.error('Failed to save submitted Market identifier:', error);
                toast.warning(t('marketSubmission.linkFailed', { identifier: result.identifier }));
              }
            }
            setSubmittedAgentId(agentId);
            setRevision((value) => value + 1);
            toast.success(t('marketSubmission.success'));
          } catch (error) {
            console.error('Failed to submit agent for Market review:', error);
            toast.error(t('marketSubmission.failed'));
            // Keep confirmation open so the user can retry after an API failure.
            throw error;
          } finally {
            busy.current = false;
            setIsSubmitting(false);
          }
        },
        title: t('marketSubmission.title'),
      });
    } catch (error) {
      // MarketAuthProvider rejects signIn when its authorization dialog is cancelled.
      if (error instanceof Error && error.message === 'User cancelled authorization') return;
      console.error('Failed to authorize Market submission:', error);
      toast.error(t('marketSubmission.failed'));
    } finally {
      busy.current = false;
    }
  };

  return { isSubmitting, isUnderReview: !!agentId && submittedAgentId === agentId, open, revision };
};
