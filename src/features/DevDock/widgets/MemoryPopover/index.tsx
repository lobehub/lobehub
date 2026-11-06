'use client';

import type { MemoryDump } from '@lobechat/electron-client-ipc';
import { Button, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Fragment, memo, useState } from 'react';

import { isDesktop } from '@/const/version';
import { electronDevtoolsService } from '@/services/electron/devtools';

import { devDockPanelStyles } from '../../panelStyles';
import { useAppProcessMetrics } from '../appProcessMetrics';
import { formatCompactSize } from '../memoryFormat';
import { type MemorySample, useMemorySamples } from '../memorySamples';
import DumpTree from './DumpTree';
import HistoryChart from './HistoryChart';
import { styles } from './styles';

const MB = 1024 * 1024;

const Stat = memo<{ hint?: string; label: string; value: string }>(({ hint, label, value }) => (
  <div {...stylex.props(styles.cell)} title={hint}>
    <span {...stylex.props(styles.key)}>{label}</span>
    <span {...stylex.props(styles.value)}>{value}</span>
  </div>
));

Stat.displayName = 'DevMemoryStat';

const Overview = memo<{ residentMB: number | null; sample: MemorySample }>(
  ({ residentMB, sample }) => {
    const { renderer } = sample;
    const heapUsed = renderer?.heap.usedBytes ?? sample.jsHeapUsedBytes;
    const heapLimit = renderer?.heap.limitBytes ?? sample.jsHeapLimitBytes;
    const reclaimable =
      residentMB !== null && renderer
        ? Math.max(0, residentMB * MB - renderer.privateBytes - renderer.sharedBytes)
        : null;

    return (
      <div {...stylex.props(styles.overview)}>
        {renderer && (
          <Fragment>
            <Stat
              hint={'process.getProcessMemoryInfo().private — what the R readout shows'}
              label={'private'}
              value={formatCompactSize(renderer.privateBytes)}
            />
            <Stat label={'shared'} value={formatCompactSize(renderer.sharedBytes)} />
            <Stat
              hint={'app.getAppMetrics() workingSetSize'}
              label={'resident'}
              value={residentMB === null ? '—' : formatCompactSize(residentMB * MB)}
            />
            <Stat
              hint={'resident − private − shared: freed pages macOS has not reclaimed yet'}
              label={'reclaimable'}
              value={reclaimable === null ? '—' : formatCompactSize(reclaimable)}
            />
          </Fragment>
        )}
        <Stat
          hint={'V8 heap used / limit'}
          label={'JS heap'}
          value={`${formatCompactSize(heapUsed)} / ${formatCompactSize(heapLimit)} · ${((heapUsed / heapLimit) * 100).toFixed(1)}%`}
        />
        {renderer && (
          <Fragment>
            <Stat
              hint={'V8 committed heap (totalHeapSize) and its physical pages'}
              label={'heap committed'}
              value={`${formatCompactSize(renderer.heap.totalBytes)} · phys ${formatCompactSize(renderer.heap.physicalBytes)}`}
            />
            <Stat
              hint={'V8 malloc outside the managed heap'}
              label={'v8 malloced'}
              value={formatCompactSize(renderer.heap.mallocedBytes)}
            />
            <Stat
              hint={'Blink (Oilpan) allocated / total'}
              label={'blink'}
              value={`${formatCompactSize(renderer.blink.allocatedBytes)} / ${formatCompactSize(renderer.blink.totalBytes)}`}
            />
          </Fragment>
        )}
      </div>
    );
  },
);

Overview.displayName = 'DevMemoryOverview';

const Breakdown = memo(() => {
  const [dump, setDump] = useState<MemoryDump | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (task: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const capture = () => run(async () => setDump(await electronDevtoolsService.captureMemoryDump()));
  const collectGarbage = () =>
    run(async () => {
      await electronDevtoolsService.collectRendererGarbage();
      setDump(await electronDevtoolsService.captureMemoryDump());
    });

  const [caller, ...others] = dump?.processes ?? [];

  return (
    <Fragment>
      <div {...stylex.props(styles.sectionTitle)}>
        <span>Breakdown</span>
        <span {...stylex.props(styles.mono, styles.muted)}>
          {dump
            ? `captured ${new Date(dump.capturedAt).toLocaleTimeString()}`
            : 'memory-infra dump'}
        </span>
        <span style={{ flex: 1 }} />
        {error && <span {...stylex.props(styles.error, styles.mono)}>{error}</span>}
        <Button disabled={loading} size={'small'} onClick={collectGarbage}>
          {'GC'}
        </Button>
        <Button loading={loading} size={'small'} onClick={capture}>
          {dump ? 'Re-capture' : 'Capture'}
        </Button>
      </div>
      {caller && <DumpTree process={caller} />}
      {others.map((process) => (
        <DumpTree key={process.pid} process={process} />
      ))}
    </Fragment>
  );
});

Breakdown.displayName = 'DevMemoryBreakdown';

const ProcessTable = memo(() => {
  const processes = useAppProcessMetrics()?.processes;
  if (!processes) return null;

  return (
    <Fragment>
      <div {...stylex.props(styles.sectionTitle)}>Processes</div>
      {[...processes]
        .sort((a, b) => b.workingSetMB - a.workingSetMB)
        .map((process) => (
          <div {...stylex.props(styles.row, styles.mono)} key={process.pid}>
            <span>
              {process.type}
              {process.name && <span {...stylex.props(styles.muted)}> · {process.name}</span>}
              <span {...stylex.props(styles.muted)}> pid {process.pid}</span>
            </span>
            <span style={{ textAlign: 'end' }}>{formatCompactSize(process.workingSetMB * MB)}</span>
            <span {...stylex.props(styles.muted)}>cpu {process.cpuPercent.toFixed(1)}%</span>
          </div>
        ))}
    </Fragment>
  );
});

ProcessTable.displayName = 'DevMemoryProcessTable';

const MemoryPopover = memo(() => {
  const samples = useMemorySamples();
  const residentMB = useAppProcessMetrics()?.rendererResidentMB ?? null;

  if (!samples) return null;

  return (
    <Flexbox className={stylex.props(devDockPanelStyles.root, styles.popover).className}>
      <Overview residentMB={residentMB} sample={samples.latest} />
      <HistoryChart history={samples.history} />
      <div {...stylex.props(styles.scroll)}>
        {isDesktop && (
          <Fragment>
            <Breakdown />
            <ProcessTable />
          </Fragment>
        )}
      </div>
      <div {...stylex.props(styles.legend)}>
        Overview samples every 2s. Breakdown attaches the CDP debugger to this renderer and requests
        one detailed memory-infra dump (~1s): v8 is the JS heap, partition_alloc holds Blink strings
        and buffers, web_cache keeps decoded script sources, blink_gc is the DOM and CSSOM, canvas
        and cc/tile_memory are raster backing stores.
      </div>
    </Flexbox>
  );
});

MemoryPopover.displayName = 'DevDockMemoryPopover';

export default MemoryPopover;
