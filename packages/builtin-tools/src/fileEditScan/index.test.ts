import { describe, expect, it } from 'vitest';

import {
  classifyEditedFile,
  type FileEditToolCallRecord,
  getBasename,
  getFileExtension,
  scanOperationFileEdits,
} from './index';

const sandboxWrite = (
  toolCallId: string,
  path: string,
  extra: Partial<{ args: unknown; success: boolean }> = {},
): FileEditToolCallRecord => ({
  apiName: 'writeFile',
  arguments: extra.args === undefined ? JSON.stringify({ path }) : (extra.args as string),
  identifier: 'lobe-cloud-sandbox',
  state: { path, success: extra.success ?? true },
  toolCallId,
});

const sandboxEdit = (
  toolCallId: string,
  path: string,
  deltas: Partial<{ diffText: string; linesAdded: number; linesDeleted: number }> = {},
): FileEditToolCallRecord => ({
  apiName: 'editFile',
  arguments: JSON.stringify({ path, replace: 'b', search: 'a' }),
  identifier: 'lobe-cloud-sandbox',
  state: { path, replacements: 1, ...deltas },
  toolCallId,
});

const sandboxMove = (
  toolCallId: string,
  results: Array<{ destination?: string; source?: string; success: boolean }>,
): FileEditToolCallRecord => ({
  apiName: 'moveFiles',
  arguments: JSON.stringify({ operations: results }),
  identifier: 'lobe-cloud-sandbox',
  state: {
    results,
    successCount: results.filter((r) => r.success).length,
    totalCount: results.length,
  },
  toolCallId,
});

const codexFileChange = (
  toolCallId: string,
  changes: Array<{
    diffText?: string;
    kind?: string;
    linesAdded?: number;
    linesDeleted?: number;
    path?: string;
  }>,
): FileEditToolCallRecord => ({
  apiName: 'file_change',
  identifier: 'codex',
  state: { changes, linesAdded: 0, linesDeleted: 0 },
  toolCallId,
});

const claudeCode = (
  toolCallId: string,
  apiName: 'Edit' | 'MultiEdit' | 'Write',
  filePath: string,
): FileEditToolCallRecord => ({
  apiName,
  arguments: JSON.stringify({ file_path: filePath }),
  identifier: 'claude-code',
  toolCallId,
});

/** lobe-local-system runCommand shell call. */
const localCommand = (
  toolCallId: string,
  command: string,
  extra: Partial<{ exitCode: number; success: boolean }> = {},
): FileEditToolCallRecord => ({
  apiName: 'runCommand',
  arguments: JSON.stringify({ command }),
  identifier: 'lobe-local-system',
  state: { isBackground: false, success: extra.success ?? true, ...extra },
  toolCallId,
});

/** claude-code Bash shell call. */
const bashCommand = (toolCallId: string, command: string): FileEditToolCallRecord => ({
  apiName: 'Bash',
  arguments: JSON.stringify({ command }),
  identifier: 'claude-code',
  toolCallId,
});

/** codex command_execution shell call. */
const codexCommand = (
  toolCallId: string,
  command: string,
  extra: Partial<{ exitCode: number; success: boolean }> = {},
): FileEditToolCallRecord => ({
  apiName: 'command_execution',
  arguments: JSON.stringify({ command }),
  identifier: 'codex',
  state: { isBackground: false, success: extra.success ?? true, ...extra },
  toolCallId,
});

describe('scanOperationFileEdits', () => {
  describe('per-source extraction', () => {
    it('extracts a sandbox writeFile as an added file on first appearance', () => {
      const result = scanOperationFileEdits([sandboxWrite('t1', '/work/a.txt')]);
      expect(result).toEqual([
        {
          diffTexts: [],
          kind: 'added',
          linesAdded: 0,
          linesDeleted: 0,
          path: '/work/a.txt',
          sourceToolCallIds: ['t1'],
        },
      ]);
    });

    it('extracts a sandbox editFile with diff + line deltas as modified', () => {
      const result = scanOperationFileEdits([
        sandboxEdit('t1', '/work/a.txt', { diffText: '@@ diff', linesAdded: 3, linesDeleted: 1 }),
      ]);
      expect(result).toEqual([
        {
          diffTexts: ['@@ diff'],
          kind: 'modified',
          linesAdded: 3,
          linesDeleted: 1,
          path: '/work/a.txt',
          sourceToolCallIds: ['t1'],
        },
      ]);
    });

    it('extracts sandbox moveFiles successful results as renames', () => {
      const result = scanOperationFileEdits([
        sandboxMove('t1', [
          { destination: '/work/b.txt', source: '/work/a.txt', success: true },
          { destination: '/work/fail.txt', source: '/work/x.txt', success: false },
        ]),
      ]);
      expect(result).toEqual([
        {
          diffTexts: [],
          kind: 'renamed',
          linesAdded: 0,
          linesDeleted: 0,
          path: '/work/b.txt',
          previousPath: '/work/a.txt',
          sourceToolCallIds: ['t1'],
        },
      ]);
    });

    it('extracts codex file_change entries with kind mapping', () => {
      const result = scanOperationFileEdits([
        codexFileChange('t1', [
          { kind: 'add', linesAdded: 5, linesDeleted: 0, path: '/a.txt' },
          { diffText: 'd', kind: 'update', linesAdded: 2, linesDeleted: 2, path: '/b.txt' },
          { kind: 'rename', path: '/c.txt' },
        ]),
      ]);
      expect(result).toEqual([
        {
          diffTexts: [],
          kind: 'added',
          linesAdded: 5,
          linesDeleted: 0,
          path: '/a.txt',
          sourceToolCallIds: ['t1'],
        },
        {
          diffTexts: ['d'],
          kind: 'modified',
          linesAdded: 2,
          linesDeleted: 2,
          path: '/b.txt',
          sourceToolCallIds: ['t1'],
        },
        // Codex renames carry no source path, so previousPath is absent.
        {
          diffTexts: [],
          kind: 'renamed',
          linesAdded: 0,
          linesDeleted: 0,
          path: '/c.txt',
          sourceToolCallIds: ['t1'],
        },
      ]);
    });

    it('extracts claude code Edit/Write/MultiEdit from file_path with 0 deltas', () => {
      const result = scanOperationFileEdits([
        claudeCode('t1', 'Write', '/a.txt'),
        claudeCode('t2', 'Edit', '/b.txt'),
        claudeCode('t3', 'MultiEdit', '/c.txt'),
      ]);
      expect(result.map((r) => [r.path, r.kind])).toEqual([
        ['/a.txt', 'added'],
        ['/b.txt', 'modified'],
        ['/c.txt', 'modified'],
      ]);
      expect(result.every((r) => r.diffTexts.length === 0)).toBe(true);
    });
  });

  describe('terminal-state folding', () => {
    it('folds write + edit + edit on one file (kind added, deltas summed)', () => {
      const result = scanOperationFileEdits([
        sandboxWrite('t1', '/a.txt'),
        sandboxEdit('t2', '/a.txt', { diffText: 'd1', linesAdded: 2, linesDeleted: 0 }),
        sandboxEdit('t3', '/a.txt', { diffText: 'd2', linesAdded: 1, linesDeleted: 4 }),
      ]);
      expect(result).toEqual([
        {
          diffTexts: ['d1', 'd2'],
          kind: 'added',
          linesAdded: 3,
          linesDeleted: 4,
          path: '/a.txt',
          sourceToolCallIds: ['t1', 't2', 't3'],
        },
      ]);
    });

    it('keeps modified when the file was only edited (not created) this operation', () => {
      const result = scanOperationFileEdits([
        sandboxEdit('t1', '/a.txt', { linesAdded: 1, linesDeleted: 0 }),
        sandboxEdit('t2', '/a.txt', { linesAdded: 1, linesDeleted: 0 }),
      ]);
      expect(result[0].kind).toBe('modified');
      expect(result[0].sourceToolCallIds).toEqual(['t1', 't2']);
    });

    it('drops an added-then-deleted file (net zero within the operation)', () => {
      const result = scanOperationFileEdits([
        sandboxWrite('t1', '/tmp.txt'),
        codexFileChange('t2', [{ kind: 'delete', path: '/tmp.txt' }]),
      ]);
      expect(result).toEqual([]);
    });

    it('marks a pre-existing file as deleted (modified-then-deleted)', () => {
      const result = scanOperationFileEdits([
        sandboxEdit('t1', '/a.txt', { linesAdded: 1 }),
        codexFileChange('t2', [{ kind: 'delete', path: '/a.txt' }]),
      ]);
      expect(result[0].kind).toBe('deleted');
      expect(result[0].sourceToolCallIds).toEqual(['t1', 't2']);
    });

    it('follows a rename chain and preserves the earliest source as previousPath', () => {
      const result = scanOperationFileEdits([
        sandboxEdit('t1', '/a.txt', { linesAdded: 2 }),
        sandboxMove('t2', [{ destination: '/b.txt', source: '/a.txt', success: true }]),
        sandboxMove('t3', [{ destination: '/c.txt', source: '/b.txt', success: true }]),
        sandboxEdit('t4', '/c.txt', { linesAdded: 1 }),
      ]);
      expect(result).toEqual([
        {
          diffTexts: [],
          kind: 'renamed',
          linesAdded: 3,
          linesDeleted: 0,
          path: '/c.txt',
          previousPath: '/a.txt',
          sourceToolCallIds: ['t1', 't2', 't3', 't4'],
        },
      ]);
    });

    it('folds a pre-existing file deleted then re-created into modified', () => {
      const result = scanOperationFileEdits([
        // No prior `added` for this path → the delete marks a pre-existing file.
        codexFileChange('t1', [{ kind: 'delete', path: '/a.txt' }]),
        sandboxWrite('t2', '/a.txt'),
      ]);
      expect(result).toEqual([
        {
          diffTexts: [],
          kind: 'modified',
          linesAdded: 0,
          linesDeleted: 0,
          path: '/a.txt',
          sourceToolCallIds: ['t1', 't2'],
        },
      ]);
    });

    it('keeps added→deleted→added as added (the net-new path is unaffected)', () => {
      const result = scanOperationFileEdits([
        sandboxWrite('t1', '/a.txt'),
        codexFileChange('t2', [{ kind: 'delete', path: '/a.txt' }]),
        sandboxWrite('t3', '/a.txt'),
      ]);
      // The added→deleted pair is dropped wholesale, so the re-add is a fresh
      // net-new entry — only t3 survives as its source.
      expect(result).toEqual([
        {
          diffTexts: [],
          kind: 'added',
          linesAdded: 0,
          linesDeleted: 0,
          path: '/a.txt',
          sourceToolCallIds: ['t3'],
        },
      ]);
    });

    it('treats a created-then-renamed file as net-new at its destination (no previousPath)', () => {
      const result = scanOperationFileEdits([
        sandboxWrite('t1', '/a.txt'),
        sandboxMove('t2', [{ destination: '/b.txt', source: '/a.txt', success: true }]),
      ]);
      expect(result).toEqual([
        {
          diffTexts: [],
          kind: 'added',
          linesAdded: 0,
          linesDeleted: 0,
          path: '/b.txt',
          sourceToolCallIds: ['t1', 't2'],
        },
      ]);
    });
  });

  describe('skipping and robustness', () => {
    it('skips a failed call (state.success === false)', () => {
      const result = scanOperationFileEdits([sandboxWrite('t1', '/a.txt', { success: false })]);
      expect(result).toEqual([]);
    });

    it('skips a call whose state carries an error', () => {
      const result = scanOperationFileEdits([
        {
          apiName: 'editFile',
          identifier: 'lobe-cloud-sandbox',
          state: { error: 'boom', path: '/a.txt' },
          toolCallId: 't1',
        },
      ]);
      expect(result).toEqual([]);
    });

    it('skips a record carrying a plugin-level error even when its state looks fine', () => {
      const result = scanOperationFileEdits([
        {
          apiName: 'writeFile',
          arguments: JSON.stringify({ path: '/a.txt' }),
          error: 'plugin exploded',
          identifier: 'lobe-cloud-sandbox',
          state: { path: '/a.txt', success: true },
          toolCallId: 't1',
        },
      ]);
      expect(result).toEqual([]);
    });

    it('ignores third-party plugins that merely reuse an editing apiName', () => {
      const result = scanOperationFileEdits([
        // apiName `file_change` but NOT the codex identifier.
        {
          apiName: 'file_change',
          identifier: 'some-third-party',
          state: { changes: [{ kind: 'add', path: '/evil.txt' }] },
          toolCallId: 't1',
        },
        // apiName `Edit` but NOT the claude-code identifier.
        {
          apiName: 'Edit',
          arguments: JSON.stringify({ file_path: '/evil2.txt' }),
          identifier: 'some-third-party',
          toolCallId: 't2',
        },
      ]);
      expect(result).toEqual([]);
    });

    it('ignores unknown apiNames (runCommand / Bash / command_execution)', () => {
      const result = scanOperationFileEdits([
        {
          apiName: 'runCommand',
          identifier: 'lobe-cloud-sandbox',
          state: { success: true },
          toolCallId: 't1',
        },
        {
          apiName: 'Bash',
          identifier: 'claude-code',
          arguments: JSON.stringify({ command: 'sed -i s/a/b/ f' }),
          toolCallId: 't2',
        },
        {
          apiName: 'command_execution',
          identifier: 'codex',
          state: { success: true },
          toolCallId: 't3',
        },
      ]);
      expect(result).toEqual([]);
    });

    it('does not throw on malformed arguments/state and returns the parseable part', () => {
      const result = scanOperationFileEdits([
        // malformed JSON arguments, but state.path is readable
        {
          apiName: 'writeFile',
          arguments: '{not json',
          identifier: 'lobe-cloud-sandbox',
          state: { path: '/a.txt', success: true },
          toolCallId: 't1',
        },
        // claude code with malformed arguments and no state → skipped, no throw
        { apiName: 'Edit', arguments: 'nope', identifier: 'claude-code', toolCallId: 't2' },
        // codex with non-array changes → skipped, no throw
        {
          apiName: 'file_change',
          identifier: 'codex',
          state: { changes: 'oops' },
          toolCallId: 't3',
        },
      ]);
      expect(result).toEqual([
        {
          diffTexts: [],
          kind: 'added',
          linesAdded: 0,
          linesDeleted: 0,
          path: '/a.txt',
          sourceToolCallIds: ['t1'],
        },
      ]);
    });

    it('normalizes surrounding whitespace but keeps case and does not merge distinct paths', () => {
      const result = scanOperationFileEdits([
        sandboxWrite('t1', '  /Work/A.txt  '),
        sandboxEdit('t2', '/Work/A.txt', { linesAdded: 1 }),
        sandboxWrite('t3', '/work/a.txt'),
      ]);
      expect(result.map((r) => r.path)).toEqual(['/Work/A.txt', '/work/a.txt']);
      expect(result[0].sourceToolCallIds).toEqual(['t1', 't2']);
    });
  });

  describe('hetero-shell command scanning', () => {
    it('detects `marp -o deck.pptx` via claude-code Bash as one modified entry', () => {
      const result = scanOperationFileEdits([bashCommand('t1', 'marp slides.md -o deck.pptx')]);
      expect(result).toEqual([
        {
          diffTexts: [],
          kind: 'modified',
          linesAdded: 0,
          linesDeleted: 0,
          path: 'deck.pptx',
          sourceToolCallIds: ['t1'],
        },
      ]);
    });

    it('detects an inline heredoc python `.save()` via lobe-local-system runCommand', () => {
      const command = [
        "python3 - <<'EOF'",
        'from docx import Document',
        'doc = Document()',
        "doc.save('/work/report.docx')",
        'EOF',
      ].join('\n');
      const result = scanOperationFileEdits([localCommand('t1', command)]);
      expect(result.map((r) => [r.path, r.kind])).toEqual([['/work/report.docx', 'modified']]);
    });

    it('detects pptxgenjs `writeFile({ fileName })` via codex command_execution (zsh-wrapped)', () => {
      const command =
        'zsh -c "node -e \'const p=require(\\"pptxgenjs\\"); const d=new p(); d.writeFile({ fileName: \\"deck.pptx\\" })\'"';
      const result = scanOperationFileEdits([codexCommand('t1', command)]);
      expect(result.map((r) => r.path)).toEqual(['deck.pptx']);
    });

    it('detects other inline write-call literals (to_excel / to_csv / write_pdf / reportlab)', () => {
      expect(
        scanOperationFileEdits([bashCommand('t1', 'python -c "df.to_excel(\'out.xlsx\')"')]).map(
          (r) => r.path,
        ),
      ).toEqual(['out.xlsx']);
      expect(
        scanOperationFileEdits([bashCommand('t2', 'python -c "df.to_csv(\'data.csv\')"')]).map(
          (r) => r.path,
        ),
      ).toEqual(['data.csv']);
      expect(
        scanOperationFileEdits([bashCommand('t3', 'python -c "html.write_pdf(\'r.pdf\')"')]).map(
          (r) => r.path,
        ),
      ).toEqual(['r.pdf']);
      expect(
        scanOperationFileEdits([
          bashCommand('t4', 'python -c "c = Canvas(\'canvas.pdf\'); c.save()"'),
        ]).map((r) => r.path),
      ).toEqual(['canvas.pdf']);
      expect(
        scanOperationFileEdits([
          bashCommand('t5', 'python -c "doc = SimpleDocTemplate(\'tpl.pdf\')"'),
        ]).map((r) => r.path),
      ).toEqual(['tpl.pdf']);
    });

    it('derives soffice `--convert-to` output (bare basename, filter suffix stripped)', () => {
      const result = scanOperationFileEdits([
        bashCommand(
          't1',
          'soffice --headless --convert-to pdf:writer_pdf_Export /work/report.docx',
        ),
      ]);
      expect(result.map((r) => r.path)).toEqual(['report.pdf']);
    });

    it('derives soffice `--convert-to` output joined under `--outdir`', () => {
      const result = scanOperationFileEdits([
        localCommand('t1', 'libreoffice --convert-to pdf --outdir /out /work/report.docx'),
      ]);
      expect(result.map((r) => r.path)).toEqual(['/out/report.pdf']);
    });

    // Regression: without the control-operator stop, `&&` / `echo` / `done`
    // would be treated as soffice inputs and derive bogus `&&.pdf` /
    // `echo.pdf` / `done.pdf` entity entries.
    it('stops soffice input collection at shell control operators', () => {
      const result = scanOperationFileEdits([
        bashCommand('t1', 'soffice --headless --convert-to pdf /work/report.docx && echo done'),
      ]);
      expect(result.map((r) => r.path)).toEqual(['report.pdf']);
    });

    it('detects a `>` redirect to an entity path', () => {
      const result = scanOperationFileEdits([bashCommand('t1', 'generate > data.csv')]);
      expect(result.map((r) => r.path)).toEqual(['data.csv']);
    });

    it('ignores fd redirects (`2>&1`, `2> err.log`) and non-entity redirects (`> notes.md`)', () => {
      expect(scanOperationFileEdits([bashCommand('t1', 'run 2>&1')])).toEqual([]);
      expect(scanOperationFileEdits([bashCommand('t2', 'run 2> err.log')])).toEqual([]);
      expect(scanOperationFileEdits([bashCommand('t3', 'echo hi > notes.md')])).toEqual([]);
    });

    it('produces nothing for read-only commands (pdftotext / load_workbook / ls glob)', () => {
      expect(scanOperationFileEdits([bashCommand('t1', 'pdftotext report.pdf out.txt')])).toEqual(
        [],
      );
      expect(
        scanOperationFileEdits([bashCommand('t2', 'python -c "load_workbook(\'data.xlsx\')"')]),
      ).toEqual([]);
      expect(scanOperationFileEdits([bashCommand('t3', 'ls *.pptx')])).toEqual([]);
    });

    it('does not treat a `curl -o report.pdf` download as an edit', () => {
      const result = scanOperationFileEdits([
        bashCommand('t1', 'curl -o report.pdf https://example.com/r.pdf'),
      ]);
      expect(result).toEqual([]);
    });

    // Regression: grep's `-o` means only-matching — its operand is a search
    // PATTERN, not an output file. Same for ps/tar/unzip `-o` meanings.
    it('does not treat a read-only CLI `-o` operand as an output file', () => {
      expect(scanOperationFileEdits([bashCommand('t1', "grep -o 'report.pdf' notes.txt")])).toEqual(
        [],
      );
      expect(scanOperationFileEdits([bashCommand('t2', 'rg -o "deck.pptx" log.txt')])).toEqual([]);
    });

    it('still detects `sort -o` (its `-o` IS an output file)', () => {
      const result = scanOperationFileEdits([bashCommand('t1', 'sort -o data.csv raw.txt')]);
      expect(result.map((r) => r.path)).toEqual(['data.csv']);
    });

    it('does not treat `cp` / `mv` destinations as edits', () => {
      expect(scanOperationFileEdits([bashCommand('t1', 'cp a.docx b.docx')])).toEqual([]);
      expect(scanOperationFileEdits([bashCommand('t2', 'mv a.pptx b.pptx')])).toEqual([]);
    });

    it('ignores the same command run via lobe-cloud-sandbox runCommand (identifier gate)', () => {
      const result = scanOperationFileEdits([
        {
          apiName: 'runCommand',
          arguments: JSON.stringify({ command: 'marp slides.md -o deck.pptx' }),
          identifier: 'lobe-cloud-sandbox',
          state: { isBackground: false, success: true },
          toolCallId: 't1',
        },
      ]);
      expect(result).toEqual([]);
    });

    it('skips a shell call that carries a plugin-level error', () => {
      const result = scanOperationFileEdits([
        {
          ...bashCommand('t1', 'marp slides.md -o deck.pptx'),
          error: 'command failed',
        },
      ]);
      expect(result).toEqual([]);
    });

    it('skips a shell call whose state reports a non-zero exit code', () => {
      // `success` left true so the skip is driven by the exitCode guard alone.
      const result = scanOperationFileEdits([
        localCommand('t1', 'marp slides.md -o deck.pptx', { exitCode: 2 }),
      ]);
      expect(result).toEqual([]);
    });

    it('folds a path detected twice within one command into a single entry', () => {
      const result = scanOperationFileEdits([
        bashCommand('t1', "python -c \"wb.save('/work/a.xlsx'); wb.save('/work/a.xlsx')\""),
      ]);
      expect(result).toEqual([
        {
          diffTexts: [],
          kind: 'modified',
          linesAdded: 0,
          linesDeleted: 0,
          path: '/work/a.xlsx',
          sourceToolCallIds: ['t1'],
        },
      ]);
    });

    it('folds a hetero-shell detection with a later sandbox writeFile on the same path', () => {
      const result = scanOperationFileEdits([
        bashCommand('t1', 'python -c "doc.save(\'/work/report.docx\')"'),
        sandboxWrite('t2', '/work/report.docx'),
      ]);
      expect(result).toEqual([
        {
          diffTexts: [],
          // shell modify then sandbox write on a pre-existing path settles to modified.
          kind: 'modified',
          linesAdded: 0,
          linesDeleted: 0,
          path: '/work/report.docx',
          sourceToolCallIds: ['t1', 't2'],
        },
      ]);
    });
  });
});

describe('classifyEditedFile', () => {
  it('classifies entity formats into their kind (case-insensitive)', () => {
    expect(classifyEditedFile('/a.pptx')).toEqual({ category: 'entity', entityKind: 'slides' });
    expect(classifyEditedFile('/a.PPT')).toEqual({ category: 'entity', entityKind: 'slides' });
    expect(classifyEditedFile('/a.xlsx')).toEqual({ category: 'entity', entityKind: 'sheet' });
    expect(classifyEditedFile('/a.xls')).toEqual({ category: 'entity', entityKind: 'sheet' });
    expect(classifyEditedFile('/a.csv')).toEqual({ category: 'entity', entityKind: 'sheet' });
    expect(classifyEditedFile('/a.docx')).toEqual({ category: 'entity', entityKind: 'doc' });
    expect(classifyEditedFile('/a.DOC')).toEqual({ category: 'entity', entityKind: 'doc' });
    expect(classifyEditedFile('/report.pdf')).toEqual({ category: 'entity', entityKind: 'pdf' });
  });

  it('classifies html files as html', () => {
    expect(classifyEditedFile('/index.html')).toEqual({ category: 'html' });
    expect(classifyEditedFile('/page.HTM')).toEqual({ category: 'html' });
  });

  it('classifies everything else as other', () => {
    expect(classifyEditedFile('/notes.md')).toEqual({ category: 'other' });
    expect(classifyEditedFile('/src/index.ts')).toEqual({ category: 'other' });
    expect(classifyEditedFile('/Makefile')).toEqual({ category: 'other' });
    expect(classifyEditedFile('/.env')).toEqual({ category: 'other' });
  });
});

describe('getBasename', () => {
  it('returns the last path segment for POSIX paths', () => {
    expect(getBasename('/mnt/data/deck.pptx')).toBe('deck.pptx');
    expect(getBasename('report.pdf')).toBe('report.pdf');
  });

  it('handles Windows separators', () => {
    expect(getBasename('C:\\Users\\me\\notes.txt')).toBe('notes.txt');
    expect(getBasename('a\\b\\c')).toBe('c');
  });

  it('tolerates a trailing slash by taking the last non-empty segment', () => {
    expect(getBasename('/mnt/data/')).toBe('data');
    expect(getBasename('folder\\')).toBe('folder');
  });

  it('trims surrounding whitespace', () => {
    expect(getBasename('  /work/a.txt  ')).toBe('a.txt');
  });

  it('returns empty string when there is no usable segment', () => {
    expect(getBasename('')).toBe('');
    expect(getBasename('///')).toBe('');
  });

  it('keeps dotfiles intact', () => {
    expect(getBasename('/etc/.env')).toBe('.env');
  });
});

describe('getFileExtension', () => {
  it('lowercases the extension without the leading dot', () => {
    expect(getFileExtension('/a/Report.PDF')).toBe('pdf');
    expect(getFileExtension('index.HTML')).toBe('html');
  });

  it('returns empty string when there is no extension', () => {
    expect(getFileExtension('/a/Makefile')).toBe('');
    expect(getFileExtension('noext')).toBe('');
  });

  it('treats a dotfile with no real extension as extension-less', () => {
    expect(getFileExtension('/etc/.env')).toBe('');
    expect(getFileExtension('.gitignore')).toBe('');
  });

  it('resolves the extension from the basename, not an earlier dotted dir', () => {
    expect(getFileExtension('/my.dir/file')).toBe('');
    expect(getFileExtension('/my.dir/a.ts')).toBe('ts');
  });
});
