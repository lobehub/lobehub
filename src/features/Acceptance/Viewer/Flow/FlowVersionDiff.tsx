'use client';

import { Flexbox } from '@lobehub/ui';
import { createModal, Select, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceBundle } from '@/services/verify';

import { diffFlowVersions } from './flowDiff';

type Version = AcceptanceBundle['flows'][number]['versions'][number];
const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: auto;
    max-height: 70dvh;
  `,
  change: css`
    padding-block: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  field: css`
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;

    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
}));

function FlowVersionDiff({ versions, selectedId }: { versions: Version[]; selectedId: string }) {
  const { t } = useTranslation('verify');
  const selected = versions.find((v) => v.id === selectedId)!;
  const [beforeId, setBeforeId] = useState(
    versions.find((v) => v.version < selected.version)?.id ??
      versions.find((v) => v.id !== selectedId)!.id,
  );
  const [afterId, setAfterId] = useState(selectedId);
  const before = versions.find((v) => v.id === beforeId)!;
  const after = versions.find((v) => v.id === afterId)!;
  const changes = diffFlowVersions(before, after);
  const displayValue = (value: string | undefined, field: string, version: Version) => {
    if (!value) return '—';
    if (field === 'required')
      return t(value === 'true' ? 'flow.diff.required' : 'flow.diff.optional');
    if (['sourceNodeKey', 'targetNodeKey', 'entryNodeKey'].includes(field))
      return version.nodes.find((node) => node.nodeKey === value)?.title ?? value;
    return value;
  };
  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align="center" gap={12}>
        <Text style={{ flex: 'none', whiteSpace: 'nowrap' }}>{t('flow.diff.before')}</Text>
        <Select
          options={versions.map((v) => ({ value: v.id, label: `v${v.version}` }))}
          value={beforeId}
          onChange={(v) => setBeforeId(String(v))}
        />
        <Text>→</Text>
        <Text style={{ flex: 'none', whiteSpace: 'nowrap' }}>{t('flow.diff.after')}</Text>
        <Select
          options={versions.map((v) => ({ value: v.id, label: `v${v.version}` }))}
          value={afterId}
          onChange={(v) => setAfterId(String(v))}
        />
      </Flexbox>
      <Text type="secondary">{t('flow.diff.hint')}</Text>
      <Flexbox className={styles.body}>
        {changes.length === 0 && <Text>{t('flow.diff.empty')}</Text>}
        {changes.map((change) => (
          <Flexbox className={styles.change} gap={12} key={`${change.kind}:${change.key}`}>
            <Flexbox horizontal gap={8}>
              <Text
                style={{
                  color:
                    change.status === 'added'
                      ? cssVar.colorSuccess
                      : change.status === 'removed'
                        ? cssVar.colorError
                        : cssVar.colorWarning,
                }}
              >
                {t(`flow.diff.${change.status}`)}
              </Text>
              <Text type="secondary">{t(`flow.diff.${change.kind}`)}</Text>
              <Text strong>{change.title}</Text>
            </Flexbox>
            {change.fields.map((value) => (
              <div className={styles.field} key={value.field}>
                <Text type="secondary">{t(`flow.diff.fields.${value.field}`)}</Text>
                <Text style={{ color: cssVar.colorTextSecondary }}>
                  {displayValue(value.before, value.field, before)}
                </Text>
                <Text>{displayValue(value.after, value.field, after)}</Text>
              </div>
            ))}
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
}

export const openFlowVersionDiff = (versions: Version[], selectedId: string) =>
  createModal({
    title: t('flow.diff.title', { ns: 'verify' }),
    content: <FlowVersionDiff selectedId={selectedId} versions={versions} />,
    footer: null,
    width: 'min(960px, 94vw)',
  });
