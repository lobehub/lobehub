import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A PNG header for a `width`×`height` image — enough for the size reader. */
export const pngHeader = (width: number, height: number) => {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
};

export interface FixtureRound {
  assets?: Record<string, Buffer | string>;
  dir: string;
  proposal?: string;
  report?: string;
  result: Record<string, unknown>;
}

/**
 * A project with one local acceptance under `.acceptances/<subjectKey>/`, its
 * rounds written the way the skill writes them. Call `cleanup` in `afterEach`.
 */
export const createLocalAcceptance = (rounds: FixtureRound[], subjectKey = 'standalone-demo') => {
  const root = mkdtempSync(path.join(tmpdir(), 'lh-local acceptance-'));
  const acceptanceDir = path.join(root, '.acceptances', subjectKey);
  const addRound = (round: FixtureRound) => {
    const roundDir = path.join(acceptanceDir, round.dir);
    mkdirSync(path.join(roundDir, 'assets'), { recursive: true });
    writeFileSync(path.join(roundDir, 'result.json'), JSON.stringify(round.result));
    if (round.proposal) writeFileSync(path.join(roundDir, 'proposal.md'), round.proposal);
    if (round.report) writeFileSync(path.join(roundDir, 'report.md'), round.report);
    for (const [name, content] of Object.entries(round.assets ?? {}))
      writeFileSync(path.join(roundDir, 'assets', name), content);
    return roundDir;
  };
  for (const round of rounds) addRound(round);
  return {
    acceptanceDir,
    addRound,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    root,
  };
};

/** A round with one screenshot check that passed and one planned video check that never ran. */
export const firstRound = (): FixtureRound => ({
  assets: {
    'after shot.png': pngHeader(800, 600),
    'api.txt': '$ curl /api/topic\n{"title":"Weekly sync"}\n',
  },
  dir: '20260101-090000-first',
  proposal: 'Rename keeps the new title.',
  report: '## Verification\n\n- tests pass',
  result: {
    cases: [
      {
        evidence: [
          { description: 'The renamed topic', path: 'assets/after shot.png' },
          { description: 'API read-back', path: 'assets/api.txt' },
        ],
        id: 'rename',
        name: 'Rename keeps the new title',
        observation: 'The list shows the new title.',
        status: 'pass',
      },
      { id: 'unit', method: 'run bun run test', name: 'Unit tests pass', status: 'pass' },
    ],
    plan: [
      {
        category: 'Rename',
        id: 'rename',
        requiredEvidence: ['screenshot', 'text'],
        title: 'Rename keeps the new title',
      },
      { category: 'Keyboard', id: 'enter', requiredEvidence: ['video'], title: 'Enter saves' },
    ],
    summary: { conclusion: 'Rename works; Enter not covered.', verdict: 'pass' },
    title: 'Topic rename',
  },
});
