'use client';

import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { Flexbox, SearchBar, Text } from '@lobehub/ui';
import { Switch, createModal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { t } from 'i18next';
import { type AiProviderModelListItem } from 'model-bank';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BrandedModelIcon } from '@/components/Branding/BrandedModelIcon';
import { formatBrandedModelId } from '@/components/Branding/brandedModelId';
import { aiModelService } from '@/services/aiModel';
import { useAiInfraStore } from '@/store/aiInfra';

const MANAGED_PROVIDER_ID = DEFAULT_PROVIDER;

const styles = createStaticStyles(({ css }) => ({
  empty: css`
    padding-block: 32px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  hint: css`
    margin-block-start: 8px;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  list: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
    max-height: min(60vh, 480px);
    margin-block-start: 12px;
  `,
  row: css`
    gap: 12px;
    align-items: center;

    margin-block: 2px;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius}px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  search: css`
    flex-shrink: 0;
  `,
}));

const EnableModelsContent = memo(() => {
  const { t } = useTranslation('components');
  const toggleProviderModelEnabled = useAiInfraStore((s) => s.toggleProviderModelEnabled);

  const [keyword, setKeyword] = useState('');
  const [models, setModels] = useState<AiProviderModelListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(() => new Set());

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      // Same as Settings → Provider: full managed catalog (no enabled filter).
      const list = await aiModelService.getAiProviderModelList(MANAGED_PROVIDER_ID);
      setModels(list.filter((model) => (model.type || 'chat') === 'chat'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return models;
    return models.filter((model) => {
      const name = (model.displayName || model.id).toLowerCase();
      const brandedId = formatBrandedModelId(model.id).toLowerCase();
      return (
        name.includes(q) || model.id.toLowerCase().includes(q) || brandedId.includes(q)
      );
    });
  }, [keyword, models]);

  const handleToggle = useCallback(
    async (model: AiProviderModelListItem, enabled: boolean) => {
      setTogglingIds((prev) => new Set(prev).add(model.id));
      // Optimistic update so the switch matches Settings behavior immediately.
      setModels((prev) =>
        prev.map((item) => (item.id === model.id ? { ...item, enabled } : item)),
      );
      try {
        await toggleProviderModelEnabled({
          enabled,
          id: model.id,
          providerId: MANAGED_PROVIDER_ID,
          source: model.source,
          type: model.type || 'chat',
        });
      } catch {
        setModels((prev) =>
          prev.map((item) =>
            item.id === model.id ? { ...item, enabled: model.enabled } : item,
          ),
        );
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(model.id);
          return next;
        });
      }
    },
    [toggleProviderModelEnabled],
  );

  return (
    <Flexbox height="100%" padding={4} style={{ minHeight: 320 }} width="100%">
      <SearchBar
        allowClear
        className={styles.search}
        placeholder={t('ModelSwitchPanel.searchPlaceholder')}
        value={keyword}
        variant="filled"
        onChange={(e) => setKeyword(e.target.value)}
      />
      <div className={styles.hint}>{t('ModelSwitchPanel.addModel.hint')}</div>

      <Flexbox className={styles.list}>
        {loading ? (
          <div className={styles.empty}>{t('ModelSwitchPanel.addModel.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>{t('ModelSwitchPanel.addModel.empty')}</div>
        ) : (
          filtered.map((model) => {
            const toggling = togglingIds.has(model.id);
            return (
              <Flexbox horizontal className={styles.row} justify="space-between" key={model.id}>
                <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
                  <BrandedModelIcon model={model.id} size={24} />
                  <Flexbox style={{ minWidth: 0 }}>
                    <Text ellipsis>{model.displayName || model.id}</Text>
                    <Text ellipsis fontSize={12} type="secondary">
                      {formatBrandedModelId(model.id)}
                    </Text>
                  </Flexbox>
                </Flexbox>
                <Switch
                  checked={Boolean(model.enabled)}
                  loading={toggling}
                  size="small"
                  onChange={(checked) => {
                    void handleToggle(model, checked);
                  }}
                />
              </Flexbox>
            );
          })
        )}
      </Flexbox>
    </Flexbox>
  );
});

EnableModelsContent.displayName = 'EnableModelsContent';

export const openEnableModelsModal = () =>
  createModal({
    content: <EnableModelsContent />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { overflow: 'hidden', paddingBlock: 8, paddingInline: 12 },
    },
    title: t('ModelSwitchPanel.addModel.title', { ns: 'components' }),
    width: 'min(90vw, 520px)',
  });

export default EnableModelsContent;
