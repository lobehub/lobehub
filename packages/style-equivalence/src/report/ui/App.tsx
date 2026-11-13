import { Flexbox, ScrollArea, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useState } from 'react';

import { fetchRun, type RunPayload } from '../api';
import { useRoute } from '../route';
import { CaseView } from './CaseView';
import { FileTree } from './FileTree';
import { FileView } from './FileView';
import { MethodPage } from './MethodPage';
import { OverviewMatrix } from './OverviewMatrix';
import { PageState } from './PageState';
import { ReviewPage } from './ReviewPage';
import { useFollowRun } from './RunBadge';
import { TopBar, VerdictStrip } from './TopBar';

const styles = stylex.create({
  app: {
    backgroundColor: cssVar.colorBgLayout,
    color: cssVar.colorText,
    display: 'flex',
    flexDirection: 'column',
    fontVariantNumeric: 'tabular-nums',
    height: '100vh',
  },
  layout: { display: 'grid', flex: '1', gridTemplateColumns: '288px minmax(0, 1fr)', minHeight: 0 },
  main: { minWidth: 0, overflowY: 'auto', paddingBlock: 24, paddingInline: 32 },
  side: {
    backgroundColor: cssVar.colorBgContainer,
    borderInlineEndColor: cssVar.colorBorderSecondary,
    borderInlineEndStyle: 'solid',
    borderInlineEndWidth: 1,
    height: '100%',
    minHeight: 0,
  },
  title: { fontSize: cssVar.fontSizeLG, fontWeight: 600, marginBlock: 0 },
});

export const App = () => {
  const route = useRoute();
  if (route.kind === 'review') return <ReviewPage initialKey={route.key} />;
  return <ReportApp route={route} />;
};

const ReportApp = ({
  route,
}: {
  route: Exclude<ReturnType<typeof useRoute>, { kind: 'review' }>;
}) => {
  const [payload, setPayload] = useState<RunPayload>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    fetchRun()
      .then(setPayload)
      .catch((reason: unknown) => setError(String(reason)));
  }, []);
  useEffect(load, [load]);
  useFollowRun(payload?.follow, load);
  if (!payload)
    return (
      <PageState
        error={error}
        loading="正在读取运行结果…"
        title="读取运行结果失败"
        onRetry={() => {
          setError(undefined);
          load();
        }}
      />
    );
  const conditions = payload.run.conditions ?? [];
  const unpaired = payload.verdict.items.filter((item) => item.category === 'unpaired');
  return (
    <div {...stylex.props(styles.app)}>
      <TopBar
        base={payload.run.base}
        follow={payload.follow}
        head={payload.run.head}
        section={route.kind === 'method' ? 'method' : 'overview'}
      />
      <VerdictStrip payload={payload} />
      <div key={payload.run.runId} {...stylex.props(styles.layout)}>
        <aside aria-label="文件" {...stylex.props(styles.side)}>
          <ScrollArea disableContentFit style={{ height: '100%' }}>
            <FileTree
              atOverview={route.kind === 'overview'}
              cases={payload.cases}
              unpaired={unpaired}
              selected={
                route.kind === 'file'
                  ? route.file
                  : route.kind === 'case'
                    ? route.key.slice(0, route.key.indexOf('|'))
                    : undefined
              }
            />
          </ScrollArea>
        </aside>
        <main {...stylex.props(styles.main)}>
          {route.kind === 'method' ? (
            <MethodPage anchor={route.anchor} payload={payload} />
          ) : route.kind === 'case' ? (
            <CaseView caseKey={route.key} payload={payload} />
          ) : route.kind === 'file' ? (
            <FileView
              cases={payload.cases}
              conditions={conditions}
              file={route.file}
              items={payload.verdict.items}
            />
          ) : (
            <Flexbox gap={16}>
              <Flexbox gap={4}>
                <h1 {...stylex.props(styles.title)}>全部文件</h1>
                <Text type="secondary">
                  每格是一个文件在这个条件下的结果，数字是有差异的用例数。点文件名进入文件视图。
                </Text>
              </Flexbox>
              <OverviewMatrix cases={payload.cases} conditions={conditions} />
            </Flexbox>
          )}
        </main>
      </div>
    </div>
  );
};
