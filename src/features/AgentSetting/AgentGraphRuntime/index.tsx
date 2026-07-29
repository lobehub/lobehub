'use client';

import type { ReasoningGraph } from '@lobechat/types';
import { ReasoningGraphSchema } from '@lobechat/types';
import { Alert, Flexbox, TextArea } from '@lobehub/ui';
import { Button, Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useStore } from '../store';
import { selectors } from '../store/selectors';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    justify-content: flex-end;
  `,
  editor: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
  item: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  itemDesc: css`
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  itemTitle: css`
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

const formatGraph = (graph?: ReasoningGraph | null) =>
  graph ? JSON.stringify(graph, null, 2) : '';

const AgentGraphRuntime = memo(() => {
  const { t } = useTranslation('setting');
  const config = useStore(selectors.currentAgentConfig, isEqual);
  const [disabled, updateConfig] = useStore((s) => [s.disabled, s.setAgentConfig]);
  const initialEnabled = config.chatConfig?.enableGraphMode === true;
  const initialGraphText = useMemo(
    () => formatGraph(config.chatConfig?.graph),
    [config.chatConfig?.graph],
  );

  const [enabled, setEnabled] = useState(initialEnabled);
  const [graphText, setGraphText] = useState(initialGraphText);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(initialEnabled);
    setGraphText(initialGraphText);
    setError(undefined);
  }, [initialEnabled, initialGraphText]);

  const isDirty = enabled !== initialEnabled || graphText !== initialGraphText;

  const handleSave = useCallback(async () => {
    if (disabled) return;

    const trimmedGraphText = graphText.trim();
    if (enabled && !trimmedGraphText) {
      setError(t('settingGraphRuntime.validation.required'));
      return;
    }

    let graph: ReasoningGraph | undefined;

    if (trimmedGraphText) {
      let parsedGraph: unknown;

      try {
        parsedGraph = JSON.parse(trimmedGraphText);
      } catch {
        setError(t('settingGraphRuntime.validation.invalidJson'));
        return;
      }

      const graphResult = ReasoningGraphSchema.safeParse(parsedGraph);

      if (!graphResult.success) {
        setError(
          t('settingGraphRuntime.validation.invalidGraph', {
            error:
              graphResult.error.issues[0]?.message || t('settingGraphRuntime.validation.unknown'),
          }),
        );
        return;
      }

      graph = graphResult.data;
    }

    setError(undefined);
    setSaving(true);

    try {
      await updateConfig({
        chatConfig: { enableGraphMode: enabled, graph: graph ?? null },
      });
    } finally {
      setSaving(false);
    }
  }, [disabled, enabled, graphText, t, updateConfig]);

  return (
    <Flexbox gap={16} width={'100%'}>
      <Flexbox horizontal align={'center'} className={styles.item} gap={16}>
        <Flexbox flex={1} gap={4}>
          <h3 className={styles.itemTitle}>{t('settingGraphRuntime.enabled.title')}</h3>
          <p className={styles.itemDesc}>{t('settingGraphRuntime.enabled.desc')}</p>
        </Flexbox>
        <Switch
          checked={enabled}
          disabled={disabled}
          onChange={(checked) => {
            setEnabled(checked);
            setError(undefined);
          }}
        />
      </Flexbox>

      <Flexbox className={styles.item} gap={12}>
        <Flexbox gap={4}>
          <h3 className={styles.itemTitle}>{t('settingGraphRuntime.snapshot.title')}</h3>
          <p className={styles.itemDesc}>{t('settingGraphRuntime.snapshot.desc')}</p>
        </Flexbox>
        <TextArea
          className={styles.editor}
          disabled={disabled}
          placeholder={t('settingGraphRuntime.snapshot.placeholder')}
          rows={16}
          value={graphText}
          onChange={(event) => {
            setGraphText(event.target.value);
            setError(undefined);
          }}
        />
      </Flexbox>

      {error && <Alert showIcon title={error} type="error" />}

      <Flexbox horizontal className={styles.actions}>
        <Button
          disabled={disabled || !isDirty}
          loading={saving}
          type={'primary'}
          onClick={handleSave}
        >
          {t('save', { ns: 'common' })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

export default AgentGraphRuntime;
