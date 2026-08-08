'use client';

import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { Flexbox, SearchBar, Text } from '@lobehub/ui';
import { Button, createModal, Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { t } from 'i18next';
import { type AiProviderModelListItem } from 'model-bank';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BrandedModelIcon } from '@/components/Branding/BrandedModelIcon';
import { aiModelService } from '@/services/aiModel';
import { useAiInfraStore } from '@/store/aiInfra';

const PAGE_SIZE = 40;
const MANAGED_PROVIDER_ID = DEFAULT_PROVIDER;

const styles = createStaticStyles(({ css }) => ({
  empty: css`
    padding-block: 32px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
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
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [enablingIds, setEnablingIds] = useState<Set<string>>(() => new Set());

  const loadPage = useCallback(async (nextOffset: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const page = await aiModelService.getAiProviderModelList(MANAGED_PROVIDER_ID, {
        enabled: false,
        limit: PAGE_SIZE,
        offset: nextOffset,
        type: 'chat',
      });

      setModels((prev) => (append ? [...prev, ...page] : page));
      setOffset(nextOffset + page.length);
      setHasMore(page.length >= PAGE_SIZE);
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return models;
    return models.filter((model) => {
      const name = (model.displayName || model.id).toLowerCase();
      return name.includes(q) || model.id.toLowerCase().includes(q);
    });
  }, [keyword, models]);

  const handleEnable = useCallback(
    async (modelId: string) => {
      setEnablingIds((prev) => new Set(prev).add(modelId));
      try {
        await toggleProviderModelEnabled({
          enabled: true,
          id: modelId,
          providerId: MANAGED_PROVIDER_ID,
          type: 'chat',
        });
        setModels((prev) => prev.filter((m) => m.id !== modelId));
      } finally {
        setEnablingIds((prev) => {
          const next = new Set(prev);
          next.delete(modelId);
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

      <Flexbox className={styles.list}>
        {loading ? (
          <div className={styles.empty}>{t('ModelSwitchPanel.addModel.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>{t('ModelSwitchPanel.addModel.empty')}</div>
        ) : (
          filtered.map((model) => {
            const enabling = enablingIds.has(model.id);
            return (
              <Flexbox horizontal className={styles.row} justify="space-between" key={model.id}>
                <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
                  <BrandedModelIcon model={model.id} size={24} />
                  <Flexbox style={{ minWidth: 0 }}>
                    <Text ellipsis>{model.displayName || model.id}</Text>
                    <Text ellipsis fontSize={12} type="secondary">
                      {model.id}
                    </Text>
                  </Flexbox>
                </Flexbox>
                <Switch
                  checked={false}
                  loading={enabling}
                  size="small"
                  onChange={(checked) => {
                    if (checked) void handleEnable(model.id);
                  }}
                />
              </Flexbox>
            );
          })
        )}

        {!loading && hasMore && !keyword.trim() && (
          <Flexbox padding={8}>
            <Button
              block
              loading={loadingMore}
              variant="filled"
              onClick={() => void loadPage(offset, true)}
            >
              {t('ModelSwitchPanel.addModel.loadMore')}
            </Button>
          </Flexbox>
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
