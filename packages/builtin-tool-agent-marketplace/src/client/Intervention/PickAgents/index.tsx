'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Avatar, Button, Flexbox, Text } from '@lobehub/ui';
import { cx } from 'antd-style';
import type { KeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { fetchAgentTemplates, getTemplatesByCategoryPriority } from '../../../data/agent-templates';
import {
  type AgentTemplate,
  type MarketplaceCategory,
  type ShowAgentMarketplaceArgs,
} from '../../../types';
import { CATEGORY_LABEL_I18N_KEYS } from './constants';
import PickAgentsSkeleton from './Skeleton';
import { styles } from './style';

const TEMPLATES_SWR_KEY = 'builtin-tool-agent-marketplace/onboarding-templates';
const EMPTY_TEMPLATES: AgentTemplate[] = [];

const PickAgentsIntervention = memo<BuiltinInterventionProps<ShowAgentMarketplaceArgs>>(
  ({ args, interactionMode, onInteractionAction }) => {
    const { t } = useTranslation('ui');
    const { t: tTool } = useTranslation('tool');
    const isCustom = interactionMode === 'custom';

    const { categoryHints, description, prompt } = args;

    const {
      data: allTemplates = EMPTY_TEMPLATES,
      isLoading,
      error,
    } = useSWR(TEMPLATES_SWR_KEY, () => fetchAgentTemplates(), {
      dedupingInterval: 60_000,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    });

    useEffect(() => {
      if (error) console.error('[AgentMarketplace] failed to load templates', error);
    }, [error]);

    const templates = useMemo(
      () => getTemplatesByCategoryPriority(allTemplates, categoryHints ?? []),
      [allTemplates, categoryHints],
    );

    const groupedTemplates = useMemo(() => {
      const map = new Map<MarketplaceCategory, AgentTemplate[]>();
      for (const tpl of templates) {
        const list = map.get(tpl.category);
        if (list) list.push(tpl);
        else map.set(tpl.category, [tpl]);
      }
      return map;
    }, [templates]);

    const availableCategories = useMemo(() => [...groupedTemplates.keys()], [groupedTemplates]);

    const [activeCategory, setActiveCategory] = useState<MarketplaceCategory | undefined>(
      () => availableCategories[0],
    );

    useEffect(() => {
      if (!activeCategory || !groupedTemplates.has(activeCategory)) {
        setActiveCategory(availableCategories[0]);
      }
    }, [activeCategory, availableCategories, groupedTemplates]);

    const visibleTemplates = useMemo(
      () => (activeCategory ? (groupedTemplates.get(activeCategory) ?? []) : []),
      [activeCategory, groupedTemplates],
    );

    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [submitting, setSubmitting] = useState(false);

    const toggle = useCallback((id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    const handleSubmit = useCallback(async () => {
      if (!onInteractionAction || selected.size === 0) return;
      setSubmitting(true);
      try {
        await onInteractionAction({
          payload: { categoryHints, requestId: args.requestId, selectedTemplateIds: [...selected] },
          type: 'submit',
        });
      } catch (error) {
        console.error('[AgentMarketplace] submit failed', error);
      } finally {
        setSubmitting(false);
      }
    }, [args.requestId, categoryHints, onInteractionAction, selected]);

    const handleSkip = useCallback(async () => {
      if (!onInteractionAction) return;
      await onInteractionAction({
        payload: { categoryHints, requestId: args.requestId },
        type: 'skip',
      });
    }, [args.requestId, categoryHints, onInteractionAction]);

    const handleCardKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>, id: string) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle(id);
        }
      },
      [toggle],
    );

    if (!isCustom) {
      return (
        <Flexbox gap={8}>
          <Text>{prompt}</Text>
          {description && (
            <Text style={{ fontSize: 13 }} type="secondary">
              {description}
            </Text>
          )}
          <Text style={{ fontSize: 12 }} type="secondary">
            {tTool('agentMarketplace.picker.summary', {
              filtered: templates.length,
              total: allTemplates.length,
            })}
          </Text>
        </Flexbox>
      );
    }

    const showLoading = isLoading && allTemplates.length === 0;
    const showEmpty = !isLoading && visibleTemplates.length === 0;

    return (
      <Flexbox className={styles.root} gap={12}>
        <div className={styles.header}>
          <Text style={{ fontWeight: 500 }}>{prompt}</Text>
          {description && (
            <Text style={{ fontSize: 13 }} type="secondary">
              {description}
            </Text>
          )}
        </div>

        {showLoading ? (
          <PickAgentsSkeleton />
        ) : showEmpty ? (
          <div className={styles.empty}>
            {error
              ? tTool('agentMarketplace.picker.failedToLoad')
              : tTool('agentMarketplace.picker.empty')}
          </div>
        ) : (
          <div className={styles.container}>
            <div aria-orientation="vertical" className={styles.sidebar} role="tablist">
              {availableCategories.map((category) => {
                const isActive = activeCategory === category;
                return (
                  <button
                    aria-selected={isActive}
                    className={cx(styles.categoryItem, isActive && styles.categoryItemActive)}
                    key={category}
                    role="tab"
                    type="button"
                    onClick={() => setActiveCategory(category)}
                  >
                    {tTool(CATEGORY_LABEL_I18N_KEYS[category])}
                  </button>
                );
              })}
            </div>

            <div className={styles.content}>
              {visibleTemplates.length === 0 ? (
                <div className={styles.empty}>{tTool('agentMarketplace.picker.empty')}</div>
              ) : (
                <div className={styles.grid}>
                  {visibleTemplates.map((tpl) => {
                    const isSelected = selected.has(tpl.id);
                    const avatar = tpl.avatar;
                    return (
                      <div
                        aria-pressed={isSelected}
                        className={cx(styles.card, isSelected && styles.cardSelected)}
                        key={tpl.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggle(tpl.id)}
                        onKeyDown={(event) => handleCardKeyDown(event, tpl.id)}
                      >
                        <Avatar avatar={avatar} shape="square" size={36} />
                        <div className={styles.cardTitle}>{tpl.title}</div>
                        {tpl.description && (
                          <div className={styles.cardDescription}>{tpl.description}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className={styles.footer}>
          <Text className={styles.skipLink} type="secondary" onClick={handleSkip}>
            {t('form.skip')}
          </Text>
          <Button
            disabled={selected.size === 0}
            loading={submitting}
            type="primary"
            onClick={handleSubmit}
          >
            {`${t('common.confirm')} (${selected.size})`}
          </Button>
        </div>
      </Flexbox>
    );
  },
);

PickAgentsIntervention.displayName = 'PickAgentsIntervention';

export default PickAgentsIntervention;
