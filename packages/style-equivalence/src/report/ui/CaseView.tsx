import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { type CaseDetail, fetchCase, type RunPayload } from '../api';
import { conditionColumns } from '../data';
import { declaredProperties } from '../declared';
import { CATEGORY_LABELS, shortKey } from '../labels';
import { hrefOf } from '../route';
import { CATEGORY_TONES, Chip } from './Chip';
import { EvidenceChain } from './EvidenceChain';
import { LiveCompare } from './LiveCompare';

const styles = stylex.create({
  back: { color: cssVar.colorTextSecondary, fontSize: 12.5 },
  body: { columnGap: 24, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' },
  file: { color: cssVar.colorTextTertiary, fontFamily: cssVar.fontFamilyCode, fontSize: 12 },
  head: {
    alignItems: 'center',
    columnGap: 12,
    display: 'flex',
    flexWrap: 'wrap',
    marginBlockEnd: 8,
    rowGap: 6,
  },
  muted: { color: cssVar.colorTextSecondary, fontSize: 13 },
  title: { fontSize: 17, fontWeight: 600, marginBlock: 0 },
});

const SIGNOFF_LABELS: Record<string, string> = {
  missing: '未签收',
  stale: '签收已失效',
  valid: '已签收',
};

export const CaseView = ({ caseKey, payload }: { caseKey: string; payload: RunPayload }) => {
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
  if (error) return <div {...stylex.props(styles.muted)}>读取用例失败：{error}</div>;
  if (!detail) return <div {...stylex.props(styles.muted)}>正在读取用例…</div>;
  const columns = conditionColumns(payload.run.conditions ?? []);
  const record = detail.case;
  const file = record?.plan.file ?? detail.item?.file ?? '';
  const category = record?.category ?? detail.item?.category ?? 'unpaired';
  const target = detail.evidence?.elements.head?.at(-1) ?? detail.evidence?.elements.base?.at(-1);
  const declared = declaredProperties([
    ...Object.values(detail.evidence?.declarations.base ?? {}),
    ...Object.values(detail.evidence?.declarations.head ?? {}),
  ]);
  return (
    <section>
      <a href={hrefOf({ file, kind: 'file' })} {...stylex.props(styles.back)}>
        ← {file}
      </a>
      <div {...stylex.props(styles.head)}>
        <h1 {...stylex.props(styles.title)}>
          {shortKey(caseKey)}
          {target ? ` · ${target.tag}` : ''}
        </h1>
        <Chip tone={CATEGORY_TONES[category] ?? 'plain'}>
          {CATEGORY_LABELS[category] ?? category}
        </Chip>
        {detail.item && SIGNOFF_LABELS[detail.item.signoff] && (
          <Chip tone={detail.item.signoff === 'valid' ? 'ok' : 'plain'}>
            {SIGNOFF_LABELS[detail.item.signoff]}
          </Chip>
        )}
        <span {...stylex.props(styles.file)}>{file}</span>
      </div>
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
          <div {...stylex.props(styles.muted)}>
            这个元素两侧配不上，没有可以对照的渲染。到签收页逐条确认。
          </div>
        )}
      </div>
    </section>
  );
};
