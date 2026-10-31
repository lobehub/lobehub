'use client';

import { createModal, Flexbox, Select, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceBundle } from '@/services/verify';

import { diffFlowVersions } from './flowDiff';

type Version = AcceptanceBundle['flows'][number]['versions'][number];
const styles = stylex.create({
  body: { overflow: 'auto', maxHeight: '70dvh' },
  change: {
    paddingBlock: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  field: {
    display: 'grid',
    gridTemplateColumns: '120px minmax(0, 1fr) minmax(0, 1fr)',
    gap: '12px',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
});

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
      <Flexbox className={stylex.props(styles.body).className}>
        {changes.length === 0 && <Text>{t('flow.diff.empty')}</Text>}
        {changes.map((change) => (
          <Flexbox
            className={stylex.props(styles.change).className}
            gap={12}
            key={`${change.kind}:${change.key}`}
          >
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
              <div {...stylex.props(styles.field)} key={value.field}>
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
