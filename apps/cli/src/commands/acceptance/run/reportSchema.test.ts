import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { planFromResult } from '../utils';
import {
  acceptanceReportSchema,
  createAcceptanceReportTemplate,
  getAcceptanceReportJsonSchema,
  validateAcceptanceReport,
} from './reportSchema';

describe('acceptance report authoring contract', () => {
  let dir: string;
  const setup = async (report: unknown) => {
    dir = await mkdtemp(path.join(tmpdir(), 'acceptance-report-'));
    await writeFile(path.join(dir, 'result.json'), JSON.stringify(report));
    return dir;
  };
  afterEach(async () => {
    if (dir) await rm(dir, { force: true, recursive: true });
  });

  it('exposes one Zod contract as JSON Schema and accepts its empty template draft', async () => {
    const template = createAcceptanceReportTemplate('web');
    expect(acceptanceReportSchema.safeParse(template).success).toBe(true);
    expect(() => getAcceptanceReportJsonSchema()).not.toThrow();
    expect(planFromResult(template)?.[0]).toMatchObject({
      id: 'replace-with-check-id',
      title: 'Describe the outcome to verify',
      verifierType: 'agent',
    });
    const result = await validateAcceptanceReport(await setup(template));
    expect(result).toMatchObject({ valid: true, draft: true, planItems: 1, cases: 0 });
  });

  it('rejects a claimed pass without its required evidence artifact', async () => {
    const report = {
      title: 'Checkout confirmation',
      plan: [
        {
          id: 'confirmation',
          title: 'Confirmation is visible',
          method: 'Complete checkout',
          expected: 'A confirmation is shown',
          requiredEvidence: ['screenshot'],
        },
      ],
      cases: [
        {
          id: 'confirmation',
          surface: 'web',
          status: 'passed',
          observation: 'Confirmation appeared.',
          evidence: [],
        },
      ],
    };
    const result = await validateAcceptanceReport(await setup(report));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('missing required evidence "screenshot"');
  });

  it('infers a file evidence type from its suffix like ingest does', async () => {
    const reportDir = await setup({
      title: 'Screenshot report',
      plan: [
        {
          id: 'screen',
          title: 'Screen is visible',
          method: 'Open the page',
          expected: 'The page is shown',
          requiredEvidence: ['screenshot'],
        },
      ],
      cases: [
        {
          id: 'screen',
          surface: 'web',
          status: 'pass',
          observation: 'The page appeared.',
          evidence: [{ description: 'Captured page', path: 'screen.png' }],
        },
      ],
    });
    await writeFile(path.join(reportDir, 'screen.png'), 'image fixture');
    expect(await validateAcceptanceReport(reportDir)).toMatchObject({ valid: true, draft: false });
  });

  it('rejects a declared screenshot type when ingest will infer text from the filename', async () => {
    const reportDir = await setup({
      title: 'Mismatched evidence',
      plan: [
        {
          id: 'proof',
          title: 'Image evidence',
          method: 'Capture the page',
          expected: 'A screenshot is saved',
          requiredEvidence: ['screenshot'],
        },
      ],
      cases: [
        {
          id: 'proof',
          surface: 'web',
          status: 'pass',
          observation: 'The page appeared.',
          evidence: [
            { type: 'screenshot', description: 'Incorrectly typed text file', path: 'proof.txt' },
          ],
        },
      ],
    });
    await writeFile(path.join(reportDir, 'proof.txt'), 'not a screenshot');
    const result = await validateAcceptanceReport(reportDir);
    expect(
      result.errors.some(
        ({ path: issuePath, message }) =>
          issuePath.endsWith('.type') &&
          message.includes('Ingest infers the type from the file suffix'),
      ),
    ).toBe(true);
    expect(
      result.errors.some(({ message }) =>
        message.includes('missing required evidence "screenshot"'),
      ),
    ).toBe(true);
  });

  it('rejects duplicate plan ids and orphan case ids', async () => {
    const result = await validateAcceptanceReport(
      await setup({
        title: 'Report',
        plan: [
          { id: 'same', title: 'One', method: 'Check', expected: 'Works', requiredEvidence: [] },
          { id: 'same', title: 'Two', method: 'Check', expected: 'Works', requiredEvidence: [] },
        ],
        cases: [
          {
            id: 'orphan',
            surface: 'cli',
            status: 'failed',
            observation: 'It failed.',
            evidence: [],
          },
        ],
      }),
    );
    expect(result.errors.map(({ message }) => message).join('\n')).toMatch(/Duplicate plan id/);
    expect(result.errors.map(({ message }) => message).join('\n')).toMatch(/not present in plan/);
  });

  it('reports an orphaned pass without dereferencing a missing plan item', async () => {
    const result = await validateAcceptanceReport(
      await setup({
        title: 'Report',
        plan: [
          {
            id: 'planned',
            title: 'Check',
            method: 'Run check',
            expected: 'Works',
            requiredEvidence: ['text'],
          },
        ],
        cases: [
          { id: 'orphan', surface: 'cli', status: 'pass', observation: 'It passed.', evidence: [] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(({ message }) => message.includes('not present in plan'))).toBe(true);
  });

  it('rejects malformed visualization metadata through the existing renderer validator', async () => {
    const result = await validateAcceptanceReport(
      await setup({
        title: 'Report',
        plan: [
          {
            id: 'data',
            title: 'Data chart',
            method: 'Inspect chart',
            expected: 'Chart renders',
            requiredEvidence: [],
          },
        ],
        cases: [
          {
            id: 'data',
            surface: 'web',
            status: 'failed',
            observation: 'Chart metadata is malformed.',
            evidence: [],
            datasets: [],
            visualizations: [{ id: 'view', type: 'bar', dataset: 'missing', version: 1 }],
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(({ message }) =>
        message.includes('invalid id, type, version, or dataset'),
      ),
    ).toBe(true);
  });

  it('preserves an honest blocked outcome and its extra metadata', async () => {
    const result = await validateAcceptanceReport(
      await setup({
        title: 'Report',
        plan: [
          {
            id: 'blocked-check',
            title: 'Service responds',
            method: 'Open the service',
            expected: 'A response is returned',
            requiredEvidence: ['text'],
          },
        ],
        cases: [
          {
            id: 'blocked-check',
            surface: 'cli',
            status: 'blocked',
            observation: 'The service was unavailable.',
            evidence: [],
            retryCount: 2,
          },
        ],
      }),
    );
    expect(result).toMatchObject({ valid: true, draft: false, cases: 1 });
    expect(result.errors).toEqual([]);
  });

  it('checks referenced file evidence and warns about unchecked remote and media facts', async () => {
    const report = {
      title: 'Report',
      plan: [
        {
          id: 'shot',
          title: 'Page is visible',
          method: 'Open the page',
          expected: 'Page loads',
          requiredEvidence: ['screenshot'],
        },
      ],
      cases: [
        {
          id: 'shot',
          surface: 'web',
          status: 'passed',
          observation: 'Page loaded.',
          evidence: [{ type: 'screenshot', description: 'Loaded page', path: 'missing.png' }],
        },
      ],
    };
    const result = await validateAcceptanceReport(await setup(report));
    expect(result.errors.some(({ message }) => message.includes('does not exist'))).toBe(true);
    expect(result.warnings[0].message).toContain('account language');
  });

  it('rejects directory evidence and accepts a contained filename beginning with two dots', async () => {
    const reportDir = await setup({
      title: 'Report',
      plan: [
        {
          id: 'file',
          title: 'File check',
          method: 'Inspect file',
          expected: 'File exists',
          requiredEvidence: [],
        },
      ],
      cases: [
        {
          id: 'file',
          surface: 'cli',
          status: 'failed',
          observation: 'Directory path is not an artifact.',
          evidence: [{ type: 'text', description: 'Directory', path: 'subdir' }],
        },
      ],
    });
    await mkdir(path.join(reportDir, 'subdir'));
    let result = await validateAcceptanceReport(reportDir);
    expect(result.errors.some(({ message }) => message.includes('not a regular file'))).toBe(true);

    await writeFile(path.join(reportDir, '..prefix.txt'), 'evidence');
    const reportWithPrefixFile = JSON.parse(
      await readFile(path.join(reportDir, 'result.json'), 'utf8'),
    );
    reportWithPrefixFile.cases[0].evidence[0].path = '..prefix.txt';
    await writeFile(path.join(reportDir, 'result.json'), JSON.stringify(reportWithPrefixFile));
    result = await validateAcceptanceReport(reportDir);
    expect(result.errors).toEqual([]);
  });

  it('marks partial plan coverage as a draft and names unexecuted checks', async () => {
    const result = await validateAcceptanceReport(
      await setup({
        title: 'Partial report',
        plan: [
          {
            id: 'done',
            title: 'First check',
            method: 'Run it',
            expected: 'Works',
            requiredEvidence: [],
          },
          {
            id: 'later',
            title: 'Second check',
            method: 'Run it',
            expected: 'Works',
            requiredEvidence: [],
          },
        ],
        cases: [
          {
            id: 'done',
            surface: 'web',
            status: 'fail',
            observation: 'The check failed.',
            evidence: [],
          },
        ],
      }),
    );
    expect(result).toMatchObject({ valid: true, draft: true, planItems: 2, cases: 1 });
    expect(result.warnings.some(({ message }) => message.includes('later'))).toBe(true);
  });

  it('rejects malformed video chapters through the shared evidence reader', async () => {
    const reportDir = await setup({
      title: 'Video report',
      plan: [
        {
          id: 'video',
          title: 'Playback',
          method: 'Play video',
          expected: 'Video plays',
          requiredEvidence: [],
        },
      ],
      cases: [
        {
          id: 'video',
          surface: 'web',
          status: 'fail',
          observation: 'The video was captured.',
          evidence: [
            {
              type: 'video',
              description: 'Capture',
              path: 'capture.mp4',
              chapters: [{ t: -1, kind: 'step', label: '' }],
            },
          ],
        },
      ],
    });
    await writeFile(path.join(reportDir, 'capture.mp4'), 'fixture');
    const result = await validateAcceptanceReport(reportDir);
    expect(
      result.errors.some(
        ({ path: issuePath, message }) =>
          issuePath.endsWith('.chapters') && message.includes('invalid'),
      ),
    ).toBe(true);
  });

  it('rejects content-only evidence even when it satisfies a required text type', async () => {
    const result = await validateAcceptanceReport(
      await setup({
        title: 'Report',
        plan: [
          {
            id: 'text',
            title: 'Text evidence',
            method: 'Read output',
            expected: 'Output is useful',
            requiredEvidence: ['text'],
          },
        ],
        cases: [
          {
            id: 'text',
            surface: 'cli',
            status: 'pass',
            observation: 'Text was attached inline.',
            evidence: [
              { type: 'text', description: 'Inline text', content: 'This is ignored by ingest.' },
            ],
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(({ path: issuePath }) => issuePath.includes('evidence'))).toBe(true);
  });

  it('does not fabricate observations or cases in the generated template', () => {
    const template = createAcceptanceReportTemplate('mobile');
    expect(template.cases).toEqual([]);
    expect(JSON.stringify(template)).not.toMatch(/observation|passed|failed|blocked/);
    expect(template.plan[0].surface).toBe('mobile');
  });
});
