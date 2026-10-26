import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { TRPCClientError } from '@trpc/client';
import { describe, expect, it, vi } from 'vitest';

import { log } from '../../../utils/logger';
import type * as VerifyHelpers from '../utils';
import { usePublicationHarness } from './testUtils';

vi.mock('../../../api/client', () => ({ getTrpcClient: vi.fn() }));
vi.mock('../../../api/workspace', () => ({ resolveWorkspaceId: vi.fn() }));
vi.mock('../../../settings', () => ({ resolveServerUrl: vi.fn() }));
vi.mock('../../../utils/uploadLocalFile', () => ({ uploadLocalFile: vi.fn() }));
vi.mock('../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof VerifyHelpers>()),
  pullRequestFromBranch: vi.fn(),
}));

const notFound = () =>
  new TRPCClientError('Project not found', {
    result: { error: { data: { code: 'NOT_FOUND' } } } as never,
  });

describe('lh acceptance run ingest — project filing', () => {
  const h = usePublicationHarness();
  const { client, run } = h;

  /** The report directory doubles as the repository root its adapter lives in. */
  const declareProject = async (config: unknown) => {
    await mkdir(path.join(h.dir, '.agents', 'acceptance'), { recursive: true });
    await writeFile(
      path.join(h.dir, '.agents', 'acceptance', 'config.json'),
      typeof config === 'string' ? config : JSON.stringify(config),
    );
  };

  const writeReport = () =>
    writeFile(
      path.join(h.dir, 'result.json'),
      JSON.stringify({
        cases: [{ id: 'screen', name: 'The result is shown', status: 'passed' }],
        title: 'Result display',
      }),
    );

  it("offers the project the repository's config declares as the fallback for a new acceptance", async () => {
    await writeReport();
    await declareProject({ project: 'LOBE' });
    client.project.find.query.mockResolvedValue({ data: { id: 'prj_lobe', name: 'LobeHub' } });
    client.acceptance.ensure.mutate.mockResolvedValue({
      id: 'acceptance-1',
      projectId: 'prj_lobe',
    });

    await run('ingest', h.dir, '--json');

    expect(client.project.find.query).toHaveBeenCalledWith({ id: 'LOBE' });
    expect(client.acceptance.ensure.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackProjectId: 'prj_lobe' }),
    );
  });

  it("stays quiet when the subject's own project outranks the declared one", async () => {
    await writeReport();
    await declareProject({ project: 'LOBE' });
    client.project.find.query.mockResolvedValue({ data: { id: 'prj_lobe', name: 'LobeHub' } });
    client.acceptance.ensure.mutate.mockResolvedValue({
      id: 'acceptance-1',
      projectId: 'prj_task',
    });

    await run('ingest', h.dir, '--json');

    expect(vi.mocked(log.warn)).not.toHaveBeenCalledWith(
      expect.stringContaining('already filed under another project'),
    );
  });

  it('lets --project override the repository declaration', async () => {
    await writeReport();
    await declareProject({ project: 'LOBE' });
    client.project.find.query.mockResolvedValue({ data: { id: 'prj_other', name: 'Other' } });

    await run('ingest', h.dir, '--project', 'other', '--json');

    expect(client.project.find.query).toHaveBeenCalledExactlyOnceWith({ id: 'other' });
    const input = client.acceptance.ensure.mutate.mock.calls[0][0];
    expect(input).toEqual(expect.objectContaining({ projectId: 'prj_other' }));
    expect(input).not.toHaveProperty('fallbackProjectId');
  });

  it('fails an unknown --project before anything is published', async () => {
    await writeReport();
    client.project.find.query.mockRejectedValue(notFound());

    await expect(run('ingest', h.dir, '--project', 'NOPE', '--json')).rejects.toThrow(
      '--project "NOPE" matches no project in this workspace.',
    );
    expect(client.acceptance.ensure.mutate).not.toHaveBeenCalled();
    expect(client.verify.createRun.mutate).not.toHaveBeenCalled();
  });

  it('publishes ungrouped, with a warning, when the declared project is not in this workspace', async () => {
    await writeReport();
    await declareProject({ project: 'LOBE' });
    client.project.find.query.mockRejectedValue(notFound());

    await run('ingest', h.dir, '--json');

    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
      expect.stringContaining('publishing ungrouped'),
    );
    expect(client.acceptance.ensure.mutate.mock.calls[0][0]).not.toHaveProperty(
      'fallbackProjectId',
    );
    expect(client.verify.createRun.mutate).toHaveBeenCalled();
  });

  it('ignores a malformed config instead of failing the round', async () => {
    await writeReport();
    await declareProject('{ "project": ');

    await run('ingest', h.dir, '--json');

    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
    expect(client.project.find.query).not.toHaveBeenCalled();
    expect(client.verify.createRun.mutate).toHaveBeenCalled();
  });

  describe('with --acceptance', () => {
    const existing = (projectId: string | null, subjectType = 'standalone', status = 'delivered') =>
      client.acceptance.getBundle.query.mockResolvedValue({
        acceptance: {
          id: 'acceptance-1',
          projectId,
          status,
          subjectId: `${subjectType}-1`,
          subjectType,
          workspaceId: null,
        },
      });

    it('files an ungrouped acceptance under the named project', async () => {
      await writeReport();
      existing(null);
      client.project.find.query.mockResolvedValue({ data: { id: 'prj_lobe', name: 'LobeHub' } });

      await run('ingest', h.dir, '--acceptance', 'acceptance-1', '--project', 'LOBE', '--json');

      expect(client.acceptance.setProject.mutate).toHaveBeenCalledWith({
        id: 'acceptance-1',
        projectId: 'prj_lobe',
      });
    });

    it("files an ungrouped standalone acceptance under the repository's project", async () => {
      await writeReport();
      await declareProject({ project: 'LOBE' });
      existing(null);
      client.project.find.query.mockResolvedValue({ data: { id: 'prj_lobe', name: 'LobeHub' } });

      await run('ingest', h.dir, '--acceptance', 'acceptance-1', '--json');

      expect(client.acceptance.setProject.mutate).toHaveBeenCalledWith({
        id: 'acceptance-1',
        projectId: 'prj_lobe',
      });
    });

    it("leaves a topic's ungrouped acceptance to its own project instead of the repository's", async () => {
      await writeReport();
      await declareProject({ project: 'LOBE' });
      existing(null, 'topic');
      client.project.find.query.mockResolvedValue({ data: { id: 'prj_lobe', name: 'LobeHub' } });

      await run('ingest', h.dir, '--acceptance', 'acceptance-1', '--json');

      expect(client.acceptance.setProject.mutate).not.toHaveBeenCalled();
    });

    it('writes nothing when the acceptance is already accepted', async () => {
      await writeReport();
      existing(null, 'standalone', 'accepted');
      client.project.find.query.mockResolvedValue({ data: { id: 'prj_lobe', name: 'LobeHub' } });
      vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
      }) as never);

      await expect(
        run('ingest', h.dir, '--acceptance', 'acceptance-1', '--project', 'LOBE', '--json'),
      ).rejects.toThrow('exit');

      expect(client.acceptance.setProject.mutate).not.toHaveBeenCalled();
    });

    it('writes nothing when the round is identical to the last one', async () => {
      await writeReport();
      await writeFile(path.join(h.dir, 'report.md'), 'Same report.');
      existing(null);
      client.acceptance.getBundle.query.mockResolvedValue({
        acceptance: (await client.acceptance.getBundle.query()).acceptance,
        rounds: [{ report: { content: 'Same report.' }, run: { id: 'run-old', roundIndex: 1 } }],
      });
      client.project.find.query.mockResolvedValue({ data: { id: 'prj_lobe', name: 'LobeHub' } });
      vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
      }) as never);

      await expect(
        run('ingest', h.dir, '--acceptance', 'acceptance-1', '--project', 'LOBE', '--json'),
      ).rejects.toThrow('exit');

      expect(client.acceptance.setProject.mutate).not.toHaveBeenCalled();
    });

    it('leaves an acceptance already filed elsewhere where it is, and says so', async () => {
      await writeReport();
      existing('prj_elsewhere');
      client.project.find.query.mockResolvedValue({ data: { id: 'prj_lobe', name: 'LobeHub' } });

      await run('ingest', h.dir, '--acceptance', 'acceptance-1', '--project', 'LOBE', '--json');

      expect(client.acceptance.setProject.mutate).not.toHaveBeenCalled();
      expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
        expect.stringContaining('already filed under another project'),
      );
    });
  });
});
