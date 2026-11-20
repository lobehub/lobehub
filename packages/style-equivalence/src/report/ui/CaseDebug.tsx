import { Accordion, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { type CaseDetail, fetchCase, type RunPayload } from '../api';
import { conditionColumns } from '../data';
import { declaredProperties } from '../declared';
import { flagLabel } from '../labels';
import { EvidenceChain } from './EvidenceChain';
import { LiveCompare } from './LiveCompare';
import { InlineState } from './PageState';

const styles = stylex.create({
  body: {
    columnGap: 24,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    paddingBlockStart: 8,
  },
});

const DebugBody = ({ caseKey, payload }: { caseKey: string; payload: RunPayload }) => {
  const [loaded, setLoaded] = useState<{ detail?: CaseDetail; error?: string; key: string }>();
  useEffect(() => {
    let current = true;
    fetchCase(caseKey)
      .then((detail) => current && setLoaded({ detail, key: caseKey }))
      .catch((reason: unknown) => current && setLoaded({ error: String(reason), key: caseKey }));
    return () => {
      current = false;
    };
  }, [caseKey]);
  const detail = loaded?.key === caseKey ? loaded.detail : undefined;
  const error = loaded?.key === caseKey ? loaded.error : undefined;
  if (!detail)
    return <InlineState error={error && `读取用例失败：${error}`} loading="正在读取用例…" />;
  const columns = conditionColumns(payload.run.conditions ?? []);
  const record = detail.case;
  const category = record?.category ?? detail.item?.category ?? 'unpaired';
  const declared = declaredProperties([
    ...Object.values(detail.evidence?.declarations.base ?? {}),
    ...Object.values(detail.evidence?.declarations.head ?? {}),
  ]);
  return (
    <div {...stylex.props(styles.body)}>
      <EvidenceChain columns={columns} detail={detail} />
      {record ? (
        <LiveCompare
          base={payload.run.base}
          caseKey={caseKey}
          columns={columns}
          combos={record.plan.combos.length}
          declared={declared}
          head={payload.run.head}
        />
      ) : (
        <Text type="secondary">
          {category === 'unpaired'
            ? '这个元素两侧配不上，没有可以对照的渲染。'
            : `这个文件有合成环境比较不了的样式用法：${(detail.item?.flags ?? []).map(flagLabel).join('、')}。`}
        </Text>
      )}
    </div>
  );
};

export const CaseDebug = ({ caseKey, payload }: { caseKey: string; payload: RunPayload }) => (
  <Accordion
    variant="outlined"
    items={[
      {
        children: <DebugBody caseKey={caseKey} payload={payload} />,
        key: 'debug',
        title: '调试信息',
      },
    ]}
  />
);
