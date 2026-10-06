import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DryRunWidgetParams,
  RequestPublishParams,
  WidgetRunRecord,
  WidgetVersionRecord,
} from '../types';
import { DashboardExecutionRuntime, type DashboardToolService, tailExcerpt } from './index';

const version = (patch: Partial<WidgetVersionRecord> = {}): WidgetVersionRecord => ({
  id: 'v1',
  manifest: { network: { allow: ['api.github.com'] } },
  outputType: 'stat',
  runtime: 'node',
  script: 'console.log(JSON.stringify({ type: "stat", value: 1 }))',
  status: 'draft',
  version: 1,
  view: null,
  ...patch,
});

const run = (patch: Partial<WidgetRunRecord> = {}): WidgetRunRecord => ({
  durationMs: 812,
  error: null,
  exitCode: 0,
  id: 'r1',
  output: { type: 'stat', value: 42 },
  status: 'succeeded',
  stderr: '',
  stdout: '{"type":"stat","value":42}',
  trigger: 'preview',
  versionId: 'v1',
  ...patch,
});

const createService = (): { [K in keyof DashboardToolService]: ReturnType<typeof vi.fn> } => ({
  addToDashboard: vi.fn(async () => ({ title: 'Ops' })),
  createDashboardWithWidget: vi.fn(async (title: string) => ({ id: 'd-new', title })),
  createWidgetDraft: vi.fn(async () => ({ version: version(), widgetId: 'w1' })),
  dryRun: vi.fn(async () => run()),
  getRun: vi.fn(async () => run()),
  getWidget: vi.fn(async () => ({ draftVersion: version(), id: 'w1', title: 'Stars' })),
  listDashboards: vi.fn(async () => []),
  listRuns: vi.fn(async () => []),
  listWidgets: vi.fn(async () => []),
  publish: vi.fn(async () => ({
    firstRunStatus: 'succeeded',
    schedulePattern: '0 * * * *',
    version: version({ status: 'published' }),
  })),
  saveDraft: vi.fn(async () => version({ id: 'v2', version: 2 })),
  updateWidget: vi.fn(async () => undefined),
});

let service: ReturnType<typeof createService>;
let runtime: DashboardExecutionRuntime;

beforeEach(() => {
  service = createService();
  runtime = new DashboardExecutionRuntime(service as unknown as DashboardToolService);
});

describe('listDashboards', () => {
  it('lists boards with their widgets and the agent’s own widgets', async () => {
    service.listDashboards.mockResolvedValue([
      { id: 'd0', projectId: 'prj_1', title: 'Launch', widgets: [] },
      { id: 'd1', title: 'Ops', widgets: [{ id: 'w1', title: 'Stars' }] },
    ]);
    service.listWidgets.mockResolvedValue([
      { hasDraft: true, id: 'w2', lastRunStatus: 'failed', published: false, title: 'Bugs' },
    ]);

    const result = await runtime.listDashboards();

    expect(result.success).toBe(true);
    expect(result.content).toContain('"Launch" (d0) [project]: no widgets');
    expect(result.content).toContain('"Ops" (d1): "Stars" (w1)');
    expect(result.content).toContain('"Bugs" (w2): not published, has draft, last run failed');
    expect(result.state.dashboards).toHaveLength(2);
  });

  it('shows the current draft version id so the model can pin it', async () => {
    service.listWidgets.mockResolvedValue([
      { draftVersionId: 'v7', hasDraft: true, id: 'w2', published: true, title: 'Bugs' },
    ]);
    const result = await runtime.listDashboards();
    expect(result.content).toContain('"Bugs" (w2): published, draft version id v7');
  });

  it('points at creating a board when there is none', async () => {
    const result = await runtime.listDashboards();
    expect(result.content).toContain('newDashboardTitle');
  });
});

describe('createWidgetDraft', () => {
  it('creates the widget with its first draft and asks for a dry run', async () => {
    const result = await runtime.createWidgetDraft({
      description: 'Stars of lobehub/lobehub',
      outputType: 'stat',
      runtime: 'node',
      script: 'x',
      title: 'Stars',
    });

    expect(service.createWidgetDraft).toHaveBeenCalledWith({
      content: { outputType: 'stat', runtime: 'node', script: 'x' },
      description: 'Stars of lobehub/lobehub',
      title: 'Stars',
    });
    expect(result).toMatchObject({
      state: { version: 1, versionId: 'v1', widgetId: 'w1' },
      success: true,
    });
    expect(result.content).toContain('dryRunWidget');
  });

  it('returns the refusal as a failed result', async () => {
    service.createWidgetDraft.mockRejectedValue(new Error('Invalid widget draft: script too long'));
    const result = await runtime.createWidgetDraft({
      description: '',
      outputType: 'stat',
      runtime: 'node',
      script: 'x',
      title: 'Stars',
    });
    expect(result).toMatchObject({ success: false });
    expect(result.content).toContain('script too long');
  });
});

describe('updateWidgetDraft', () => {
  it('keeps unchanged fields from the current draft and links the parent version', async () => {
    const result = await runtime.updateWidgetDraft({ script: 'fixed', widgetId: 'w1' });

    expect(service.saveDraft).toHaveBeenCalledWith('w1', {
      changeNote: null,
      manifest: { network: { allow: ['api.github.com'] } },
      outputType: 'stat',
      parentVersionId: 'v1',
      runtime: 'node',
      script: 'fixed',
      view: null,
    });
    expect(result).toMatchObject({ state: { version: 2, versionId: 'v2' }, success: true });
  });

  it('falls back to the published version when there is no draft', async () => {
    service.getWidget.mockResolvedValue({
      id: 'w1',
      publishedVersion: version({ id: 'v-live', status: 'published' }),
      title: 'Stars',
    });
    await runtime.updateWidgetDraft({ view: { limit: 5 }, widgetId: 'w1' });
    expect(service.saveDraft).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ parentVersionId: 'v-live', view: { limit: 5 } }),
    );
  });

  it('only renames when no content changes', async () => {
    const result = await runtime.updateWidgetDraft({ title: 'Stars (7d)', widgetId: 'w1' });
    expect(service.updateWidget).toHaveBeenCalledWith('w1', {
      description: undefined,
      title: 'Stars (7d)',
    });
    expect(service.saveDraft).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('says so when identical content reuses the draft', async () => {
    service.saveDraft.mockResolvedValue(version());
    const result = await runtime.updateWidgetDraft({ script: 'same', widgetId: 'w1' });
    expect(result.content).toContain('identical');
  });

  it('leaves the title and description untouched when the draft is refused', async () => {
    service.saveDraft.mockRejectedValue(new Error('Invalid widget draft: manifest.env'));

    const result = await runtime.updateWidgetDraft({
      description: 'New definition',
      script: 'console.log(1)',
      title: 'Renamed',
      widgetId: 'w1',
    });

    expect(result.success).toBe(false);
    expect(service.updateWidget).not.toHaveBeenCalled();
  });

  it('saves the draft before renaming when both change', async () => {
    await runtime.updateWidgetDraft({ script: 'console.log(2)', title: 'Renamed', widgetId: 'w1' });
    expect(service.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      service.updateWidget.mock.invocationCallOrder[0],
    );
  });

  it('renames nothing when there is no version to keep', async () => {
    service.getWidget.mockResolvedValue({ id: 'w1', title: 'Stars' });
    const result = await runtime.updateWidgetDraft({ title: 'Renamed', widgetId: 'w1' });
    expect(result.success).toBe(false);
    expect(service.updateWidget).not.toHaveBeenCalled();
  });

  it('fails for an unknown widget', async () => {
    service.getWidget.mockResolvedValue(undefined);
    const result = await runtime.updateWidgetDraft({ script: 'x', widgetId: 'nope' });
    expect(result).toMatchObject({ success: false });
  });
});

describe('dryRunWidget', () => {
  it('returns the real output of a successful run and points at publishing', async () => {
    const result = await runtime.dryRunWidget({ versionId: 'v1', widgetId: 'w1' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Dry run succeeded');
    expect(result.content).toContain('"value": 42');
    expect(result.content).toContain('requestPublish');
    expect(result.state).toMatchObject({ runId: 'r1', status: 'succeeded', versionId: 'v1' });
  });

  it('treats a partial run as working but asks to report what is missing', async () => {
    service.dryRun.mockResolvedValue(run({ status: 'partial' }));

    const result = await runtime.dryRunWidget({ versionId: 'v1', widgetId: 'w1' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Dry run partial');
    expect(result.content).toContain('incomplete result');
    expect(result.state).toMatchObject({ status: 'partial' });
  });

  it('gives a failing script back with its logs and a repair hint, as a normal result', async () => {
    service.dryRun.mockResolvedValue(
      run({
        error: { code: 'INVALID_JSON', message: 'stdout is not a JSON document' },
        exitCode: 0,
        output: null,
        status: 'failed',
        stderr: 'warning: deprecated',
        stdout: 'fetching…\n{"type":"stat","value":1}',
      }),
    );

    const result = await runtime.dryRunWidget({ versionId: 'v1', widgetId: 'w1' });

    // The model repairs the script from this, so the call itself succeeds.
    expect(result.success).toBe(true);
    expect(result.content).toContain('[INVALID_JSON]');
    expect(result.content).toContain('move every other print/echo to stderr');
    expect(result.content).toContain('stdout:\nfetching…');
    expect(result.content).toContain('stderr:\nwarning: deprecated');
    expect(result.content).toContain('updateWidgetDraft');
    expect(result.state).toMatchObject({ error: { code: 'INVALID_JSON' }, status: 'failed' });
  });

  it('runs exactly the named version and never falls back to the current draft', async () => {
    const result = await runtime.dryRunWidget({ widgetId: 'w1' } as DryRunWidgetParams);

    expect(service.dryRun).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.content).toContain('versionId is required');

    await runtime.dryRunWidget({ versionId: 'v4', widgetId: 'w1' });
    expect(service.dryRun).toHaveBeenCalledWith('w1', 'v4');
  });

  it('fails when the widget cannot be dry-run at all', async () => {
    service.dryRun.mockRejectedValue(new Error('Only the widget creator can change it'));
    const result = await runtime.dryRunWidget({ versionId: 'v1', widgetId: 'w1' });
    expect(result).toMatchObject({ success: false });
  });
});

describe('requestPublish', () => {
  it('publishes the pinned version and reports the first live run', async () => {
    const result = await runtime.requestPublish({ versionId: 'v1', widgetId: 'w1' });

    expect(service.publish).toHaveBeenCalledWith('w1', 'v1');
    expect(result.success).toBe(true);
    expect(result.content).toContain('refreshes on "0 * * * *"');
    expect(result.content).toContain('First live run: succeeded');
  });

  it('relays the dry-run gate', async () => {
    service.publish.mockRejectedValue(new Error('dry-run it before publishing'));
    const result = await runtime.requestPublish({ versionId: 'v9', widgetId: 'w1' });
    expect(service.publish).toHaveBeenCalledWith('w1', 'v9');
    expect(result).toMatchObject({ success: false });
    expect(result.content).toContain('dry-run it before publishing');
  });

  it('never re-reads the current draft when no version was pinned', async () => {
    // A newer draft saved while the approval was pending must not go live.
    service.getWidget.mockResolvedValue({
      draftVersion: version({ id: 'v-newer', version: 2 }),
      id: 'w1',
      title: 'Stars',
    });

    const result = await runtime.requestPublish({ widgetId: 'w1' } as RequestPublishParams);

    expect(service.getWidget).not.toHaveBeenCalled();
    expect(service.publish).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.content).toContain('versionId is required');
  });
});

describe('addWidgetToDashboard', () => {
  it('places the widget on an existing board', async () => {
    const result = await runtime.addWidgetToDashboard({ dashboardId: 'd1', widgetId: 'w1' });
    expect(service.createDashboardWithWidget).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      state: { createdDashboard: false, dashboardId: 'd1', dashboardTitle: 'Ops' },
      success: true,
    });
  });

  it('creates the board and the placement in one operation when asked', async () => {
    const result = await runtime.addWidgetToDashboard({
      newDashboardTitle: ' Team health ',
      widgetId: 'w1',
    });
    expect(service.createDashboardWithWidget).toHaveBeenCalledWith('Team health', 'w1');
    expect(service.addToDashboard).not.toHaveBeenCalled();
    expect(result.state).toMatchObject({
      createdDashboard: true,
      dashboardId: 'd-new',
      dashboardTitle: 'Team health',
    });
  });

  it('reports a failed create-and-place without a separate board write', async () => {
    service.createDashboardWithWidget.mockRejectedValue(new Error('Widget not found'));
    const result = await runtime.addWidgetToDashboard({ newDashboardTitle: 'X', widgetId: 'w9' });
    expect(result).toMatchObject({ success: false });
    expect(result.content).toContain('Widget not found');
  });

  it('carries the board project so the card links to the project dashboard', async () => {
    service.addToDashboard.mockResolvedValue({ projectId: 'prj_1', title: 'Project ops' });
    const result = await runtime.addWidgetToDashboard({ dashboardId: 'd2', widgetId: 'w1' });
    expect(result.state).toMatchObject({ dashboardId: 'd2', projectId: 'prj_1' });
  });

  it('needs a target', async () => {
    const result = await runtime.addWidgetToDashboard({ widgetId: 'w1' });
    expect(result.success).toBe(false);
  });
});

describe('getWidgetRuns', () => {
  it('lists recent runs with a clamped limit', async () => {
    service.listRuns.mockResolvedValue([
      run({ error: { code: 'TIMEOUT', message: 'too slow' }, id: 'r2', status: 'timeout' }),
      run(),
    ]);
    const result = await runtime.getWidgetRuns({ limit: 500, widgetId: 'w1' });

    expect(service.listRuns).toHaveBeenCalledWith('w1', 50);
    expect(result.content).toContain('[TIMEOUT] too slow');
    expect(result.state.runs.map((item: { id: string }) => item.id)).toEqual(['r2', 'r1']);
  });

  it('returns one run in full', async () => {
    const result = await runtime.getWidgetRuns({ runId: 'r1', widgetId: 'w1' });
    expect(service.getRun).toHaveBeenCalledWith('w1', 'r1');
    expect(result.content).toContain('"value": 42');
  });
});

describe('tailExcerpt', () => {
  it('keeps the end of long logs, where errors are', () => {
    const text = `${'a'.repeat(50)}END`;
    expect(tailExcerpt(text, 10)).toBe('…(43 earlier chars omitted)\naaaaaaaEND');
    expect(tailExcerpt(null)).toBe('');
  });
});
