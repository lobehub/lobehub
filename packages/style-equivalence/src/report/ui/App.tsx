import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { fetchRun, type RunPayload } from '../api';
import { useRoute } from '../route';
import { CaseView } from './CaseView';
import { FileTree } from './FileTree';
import { FileView } from './FileView';
import { OverviewMatrix } from './OverviewMatrix';
import { TopBar, VerdictStrip } from './TopBar';

const styles = stylex.create({
  app: {
    backgroundColor: cssVar.colorBgLayout,
    color: cssVar.colorText,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: cssVar.fontFamily,
    fontVariantNumeric: 'tabular-nums',
    height: '100vh',
  },
  center: { color: cssVar.colorTextSecondary, fontSize: 13, padding: 40 },
  heading: { fontSize: 15, fontWeight: 600, marginBlock: 0 },
  layout: { display: 'grid', flex: '1', gridTemplateColumns: '300px 1fr', minHeight: 0 },
  main: { minWidth: 0, overflowY: 'auto', padding: 20 },
  side: {
    backgroundColor: cssVar.colorBgContainer,
    borderInlineEndColor: cssVar.colorBorderSecondary,
    borderInlineEndStyle: 'solid',
    borderInlineEndWidth: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  sub: {
    color: cssVar.colorTextSecondary,
    fontSize: 12.5,
    marginBlockEnd: 12,
    marginBlockStart: 4,
  },
});

export const App = () => {
  const route = useRoute();
  const [payload, setPayload] = useState<RunPayload>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    fetchRun()
      .then(setPayload)
      .catch((reason: unknown) => setError(String(reason)));
  }, []);
  if (error) return <div {...stylex.props(styles.center)}>读取运行结果失败：{error}</div>;
  if (!payload) return <div {...stylex.props(styles.center)}>正在读取运行结果…</div>;
  const conditions = payload.run.conditions ?? [];
  const unpaired = payload.verdict.items.filter((item) => item.category === 'unpaired');
  return (
    <div {...stylex.props(styles.app)}>
      <TopBar run={payload.run} />
      <VerdictStrip payload={payload} />
      <div {...stylex.props(styles.layout)}>
        <aside {...stylex.props(styles.side)}>
          <FileTree
            cases={payload.cases}
            selected={route.kind === 'file' ? route.file : undefined}
            unpaired={unpaired}
          />
        </aside>
        <main {...stylex.props(styles.main)}>
          {route.kind === 'case' ? (
            <CaseView caseKey={route.key} payload={payload} />
          ) : route.kind === 'file' ? (
            <FileView
              cases={payload.cases}
              conditions={conditions}
              file={route.file}
              items={payload.verdict.items}
            />
          ) : (
            <section>
              <h2 {...stylex.props(styles.heading)}>全部文件 · 总览</h2>
              <div {...stylex.props(styles.sub)}>
                每格是该文件全部用例在这个条件下的结果，数字是有差异的用例数。点文件名进入文件视图。
              </div>
              <OverviewMatrix cases={payload.cases} conditions={conditions} />
            </section>
          )}
        </main>
      </div>
    </div>
  );
};
