'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Avatar, Button, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { KeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  fetchAgentTemplates,
  getAgentTemplatesSWRKey,
  getTemplatesByCategoryPriority,
} from '../../../data/agent-templates';
import type { AgentTemplate, MarketplaceCategory, ShowAgentMarketplaceArgs } from '../../../types';
import { CATEGORY_LABEL_I18N_KEYS } from './constants';
import PickAgentsSkeleton from './Skeleton';
import { styles } from './style';

const EMPTY_TEMPLATES: AgentTemplate[] = [];

const PickAgentsIntervention = memo<BuiltinInterventionProps<ShowAgentMarketplaceArgs>>(
  ({ args, disabled = false, interactionMode, onInteractionAction }) => {
    const { t } = useTranslation('ui');
    const { t: tTool } = useTranslation('tool');
    const isCustom = interactionMode === 'custom';

    const { categoryHints, description, prompt } = args;

    const { i18n } = useTranslation();
    const swrLocale = i18n.resolvedLanguage || i18n.language;

    const {
      data: allTemplates = EMPTY_TEMPLATES,
      isLoading,
      error,
    } = useSWR(getAgentTemplatesSWRKey(swrLocale), () => fetchAgentTemplates(), {
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

    const toggle = useCallback(
      (id: string) => {
        if (disabled) return;
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      },
      [disabled],
    );

    const handleSubmit = useCallback(async () => {
      if (!onInteractionAction || selected.size === 0 || disabled) return;
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
    }, [args.requestId, categoryHints, disabled, onInteractionAction, selected]);

    const handleSkip = useCallback(async () => {
      if (!onInteractionAction || disabled) return;
      await onInteractionAction({
        payload: { categoryHints, requestId: args.requestId },
        type: 'skip',
      });
    }, [args.requestId, categoryHints, disabled, onInteractionAction]);

    const handleCardKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>, id: string) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle(id);
        }
      },
      [disabled, toggle],
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
      <Flexbox className={stylex.props(styles.root).className} gap={12}>
        <div {...stylex.props(styles.header)}>
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
          <div {...stylex.props(styles.empty)}>
            {error
              ? tTool('agentMarketplace.picker.failedToLoad')
              : tTool('agentMarketplace.picker.empty')}
          </div>
        ) : (
          <div {...stylex.props(styles.container)}>
            <div aria-orientation="horizontal" {...stylex.props(styles.tabBar)} role="tablist">
              {availableCategories.map((category) => {
                const isActive = activeCategory === category;
                return (
                  <button
                    aria-selected={isActive}
                    {...stylex.props(styles.categoryItem, isActive && styles.categoryItemActive)}
                    disabled={disabled}
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

            <div {...stylex.props(styles.content)}>
              {visibleTemplates.length === 0 ? (
                <div {...stylex.props(styles.empty)}>{tTool('agentMarketplace.picker.empty')}</div>
              ) : (
                <div {...stylex.props(styles.grid)}>
                  {visibleTemplates.map((tpl) => {
                    const isSelected = selected.has(tpl.id);
                    const avatar = tpl.avatar;
                    return (
                      <div
                        aria-disabled={disabled}
                        aria-pressed={isSelected}
                        {...stylex.props(styles.card, isSelected && styles.cardSelected)}
                        key={tpl.id}
                        role="button"
                        tabIndex={disabled ? -1 : 0}
                        onClick={() => toggle(tpl.id)}
                        onKeyDown={(event) => handleCardKeyDown(event, tpl.id)}
                      >
                        <div {...stylex.props(styles.cardHeader)}>
                          <Avatar avatar={avatar} shape="square" size={36} />
                          <div {...stylex.props(styles.cardTitle)}>{tpl.title}</div>
                        </div>
                        {tpl.description && (
                          <div {...stylex.props(styles.cardDescription)}>{tpl.description}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div {...stylex.props(styles.footer)}>
          <Text
            className={stylex.props(styles.skipLink).className}
            type="secondary"
            onClick={disabled ? undefined : handleSkip}
          >
            {t('form.skip')}
          </Text>
          <Button
            disabled={disabled || selected.size === 0}
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
