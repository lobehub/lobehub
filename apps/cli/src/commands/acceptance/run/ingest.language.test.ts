import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { log } from '../../../utils/logger';
import { uploadLocalFile } from '../../../utils/uploadLocalFile';
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

describe('lh acceptance run', () => {
  const h = usePublicationHarness();
  const { client, result, run } = h;

  describe('report language', () => {
    const englishReport = async () => {
      await writeFile(
        path.join(h.dir, 'result.json'),
        JSON.stringify({
          cases: [{ id: 'screen', name: '用户能看到处理结果', observation: 'The page shows it.' }],
          plan: [{ expected: '页面显示结果', id: 'screen', title: '用户能看到处理结果' }],
          summary: { conclusion: '通过', verdict: 'passed' },
          title: '处理结果展示',
        }),
      );
      await writeFile(path.join(h.dir, 'report.md'), 'All checks passed.');
    };

    it('rejects a report in the wrong language before any remote write', async () => {
      client.user.getUserState.query.mockResolvedValue({
        settings: { general: { responseLanguage: 'zh-CN' } },
      });
      await englishReport();

      const error = await run('ingest', h.dir).catch((e: unknown) => e);

      expect(String(error)).toContain('responseLanguage) is "zh-CN"');
      expect(String(error)).toContain('cases[screen].observation');
      expect(String(error)).toContain('report.md');
      expect(String(error)).not.toContain('plan[screen].title');
      expect(client.acceptance.ensure.mutate).not.toHaveBeenCalled();
      expect(client.verify.createRun.mutate).not.toHaveBeenCalled();
    });

    it('validates a plan-only report with --dry-run without publishing', async () => {
      client.user.getUserState.query.mockResolvedValue({
        settings: { general: { responseLanguage: 'zh-CN' } },
      });
      await writeFile(
        path.join(h.dir, 'result.json'),
        JSON.stringify({
          plan: [{ id: 'screen', method: 'Open the page', title: '用户能看到处理结果' }],
          title: '处理结果展示',
        }),
      );

      await expect(run('ingest', h.dir, '--dry-run')).rejects.toThrow('plan[screen].method');

      await writeFile(
        path.join(h.dir, 'result.json'),
        JSON.stringify({
          plan: [{ id: 'screen', method: '打开页面', title: '用户能看到处理结果' }],
          title: '处理结果展示',
        }),
      );
      await run('ingest', h.dir, '--dry-run', '--json');

      expect(result()).toMatchObject({
        dryRun: true,
        language: { enforced: true, locale: 'zh-CN', status: 'enforced' },
        planItems: 1,
      });
      expect(client.acceptance.ensure.mutate).not.toHaveBeenCalled();
      expect(client.verify.createRun.mutate).not.toHaveBeenCalled();
    });

    it('rejects an English category, which renders as the checklist group heading', async () => {
      client.user.getUserState.query.mockResolvedValue({
        settings: { general: { responseLanguage: 'zh-CN' } },
      });
      await writeFile(
        path.join(h.dir, 'result.json'),
        JSON.stringify({
          plan: [{ category: 'Task hierarchy', id: 'screen', title: '用户能看到处理结果' }],
          title: '处理结果展示',
        }),
      );

      await expect(run('ingest', h.dir, '--dry-run')).rejects.toThrow('plan[screen].category');
    });

    it('rejects an English required-evidence hint, shown as the evidence tooltip', async () => {
      client.user.getUserState.query.mockResolvedValue({
        settings: { general: { responseLanguage: 'zh-CN' } },
      });
      await writeFile(
        path.join(h.dir, 'result.json'),
        JSON.stringify({
          plan: [
            {
              id: 'screen',
              requiredEvidence: [{ hint: 'Capture checkout result', type: 'screenshot' }],
              title: '用户能看到处理结果',
            },
          ],
          title: '处理结果展示',
        }),
      );

      await expect(run('ingest', h.dir, '--dry-run')).rejects.toThrow(
        'plan[screen].requiredEvidence[0].hint',
      );
    });

    it('rejects English captions in `evidence upload --metadata` before uploading', async () => {
      client.user.getUserState.query.mockResolvedValue({
        settings: { general: { responseLanguage: 'zh-CN' } },
      });

      await expect(
        run(
          'evidence',
          'upload',
          '--check',
          'result-screen',
          '--content',
          '日志',
          '--type',
          'text',
          '--desc',
          '执行记录',
          '--metadata',
          JSON.stringify({
            chapters: [{ kind: 'step', label: 'Open checkout', t: 0 }],
            comparison: { id: 'pair', label: '重试前', role: 'before' },
          }),
        ),
      ).rejects.toThrow('--metadata.chapters[0].label');
      expect(client.verify.uploadEvidence.mutate).not.toHaveBeenCalled();
    });

    it('rejects English chapter captions in `result submit --chapters` before uploading', async () => {
      client.user.getUserState.query.mockResolvedValue({
        settings: { general: { responseLanguage: 'zh-CN' } },
      });
      await writeFile(
        path.join(h.dir, 'chapters.json'),
        JSON.stringify([
          { kind: 'step', label: '刷新页面', t: 0 },
          { kind: 'check', note: 'Device chip shows on the first frame', t: 1.5 },
        ]),
      );

      await expect(
        run(
          'result',
          'submit',
          '--operation',
          'op-1',
          '--item',
          'reload',
          '--file',
          path.join(h.dir, 'scroll.mp4'),
          '--type',
          'video',
          '--desc',
          '刷新后的录屏',
          '--chapters',
          path.join(h.dir, 'chapters.json'),
        ),
      ).rejects.toThrow('--chapters.chapters[1].note');
      expect(uploadLocalFile).not.toHaveBeenCalled();
      expect(client.verify.submitCheckEvidence.mutate).not.toHaveBeenCalled();
    });

    it('rejects `run create` with a title in the wrong language', async () => {
      client.user.getUserState.query.mockResolvedValue({
        settings: { general: { responseLanguage: 'zh-CN' } },
      });

      await expect(
        run('create', '--title', 'Checkout recovery', '--goal', '验证重试'),
      ).rejects.toThrow('--title');
      expect(client.verify.createRun.mutate).not.toHaveBeenCalled();
    });

    it('warns and still publishes when the account has no response language', async () => {
      client.user.getUserState.query.mockResolvedValue({ settings: { general: {} } });
      await englishReport();

      await run('ingest', h.dir, '--json');

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('no response language set'));
      expect(client.verify.createRun.mutate).toHaveBeenCalledOnce();
    });
  });
});
