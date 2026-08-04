import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { FileLoaderInterface } from '../../types';
import { IpynbLoader, convertIpynbToMarkdown, scrubIpynbFallbackText } from './index';

const fixturePath = (filename: string) => path.join(__dirname, `./fixtures/${filename}`);

const makeNotebook = (cells: unknown[]) =>
  JSON.stringify({
    cells,
    metadata: {
      kernelspec: { display_name: 'Python 3', name: 'python3' },
      language_info: { name: 'python', version: '3.11.0' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  });

describe('convertIpynbToMarkdown', () => {
  it('returns null for invalid JSON or non-notebook JSON', () => {
    expect(convertIpynbToMarkdown('not json')).toBeNull();
    expect(convertIpynbToMarkdown('{"foo": 1}')).toBeNull();
  });

  it('returns null for legacy nbformat v3', () => {
    // A cells array is required to reach the nbformat gate at all — without
    // it the earlier missing-cells check returns first and this branch would
    // go unpinned.
    expect(
      convertIpynbToMarkdown(
        JSON.stringify({ cells: [{ cell_type: 'markdown', source: 'hi' }], nbformat: 3 }),
      ),
    ).toBeNull();
  });

  it('keeps markdown cells and full code sources with execution counts', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        { cell_type: 'markdown', metadata: {}, source: ['# Title\n', 'text'] },
        {
          cell_type: 'code',
          execution_count: 3,
          metadata: {},
          outputs: [],
          source: 'x = 1\nprint(x)',
        },
      ]),
    )!;
    expect(md).toContain('> Jupyter notebook · kernel: Python 3 · language: python 3.11.0');
    expect(md).toContain('# Title\ntext');
    expect(md).toContain('**In [3]:**');
    expect(md).toContain('```python\nx = 1\nprint(x)\n```');
  });

  it('replaces image outputs with a sized placeholder', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 1,
          metadata: {},
          outputs: [
            { data: { 'image/png': 'A'.repeat(2048) }, metadata: {}, output_type: 'display_data' },
          ],
          source: 'plt.show()',
        },
      ]),
    )!;
    expect(md).toContain('![image/png output — 2 KB, omitted]');
    expect(md).not.toContain('AAAA');
  });

  it('keeps script-free html minus its style block and drops the text/plain twin', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 2,
          metadata: {},
          outputs: [
            {
              data: {
                'text/html': [
                  '<style>.df { color: red; }</style>',
                  '<table><tr><td>1</td></tr></table>',
                ],
                'text/plain': '   a\n0  1',
              },
              metadata: {},
              output_type: 'execute_result',
            },
          ],
          source: 'df',
        },
      ]),
    )!;
    expect(md).toContain('<table><tr><td>1</td></tr></table>');
    expect(md).not.toContain('<style>');
    expect(md).not.toContain('color: red');
    expect(md).not.toContain('0  1');
  });

  it('replaces script-bearing html outputs with a placeholder', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 4,
          metadata: {},
          outputs: [
            {
              data: { 'text/html': '<div id="p"></div><script>window.Plotly = {};</script>' },
              metadata: {},
              output_type: 'display_data',
            },
          ],
          source: 'fig.show()',
        },
      ]),
    )!;
    expect(md).toContain('[interactive HTML output (script)');
    expect(md).not.toContain('<script');
  });

  it('replaces widget views with a placeholder', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 5,
          metadata: {},
          outputs: [
            {
              data: {
                'application/vnd.jupyter.widget-view+json': { model_id: 'abc', version_major: 2 },
                'text/plain': 'HBox(children=…)',
              },
              metadata: {},
              output_type: 'display_data',
            },
          ],
          source: 'tqdm(range(10))',
        },
      ]),
    )!;
    expect(md).toContain('`[interactive widget — omitted]`');
    expect(md).not.toContain('HBox');
  });

  it('scrubs long base64 data uris inside script-free html (Audio/Image embeds)', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 8,
          metadata: {},
          outputs: [
            {
              data: {
                'text/html':
                  '<audio controls="controls"><source src="data:audio/wav;base64,' +
                  'U'.repeat(2048) +
                  '" type="audio/wav" /></audio>',
              },
              metadata: {},
              output_type: 'display_data',
            },
          ],
          source: 'ipd.Audio(x, rate=16000)',
        },
      ]),
    )!;
    expect(md).toContain('<audio');
    expect(md).toContain('data:audio/wav;base64,[2 KB omitted]');
    expect(md).not.toContain('UUUU');
  });

  it('strips ansi codes and collapses \r progress lines in streams', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 6,
          metadata: {},
          outputs: [
            {
              name: 'stdout',
              output_type: 'stream',
              text: ' 10%|#\r 50%|#####\r100%|##########\nDone: \u001B[32mok\u001B[0m',
            },
          ],
          source: 'train()',
        },
      ]),
    )!;
    expect(md).toContain('100%|##########');
    expect(md).not.toContain(' 10%');
    expect(md).toContain('Done: ok');
    expect(md).not.toContain('\u001B');
  });

  it('keeps error name, value and the full traceback minus ansi', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 7,
          metadata: {},
          outputs: [
            {
              ename: 'ValueError',
              evalue: 'boom',
              output_type: 'error',
              traceback: ['\u001B[0;31mValueError\u001B[0m: boom', 'very long frame line'],
            },
          ],
          source: 'raise ValueError("boom")',
        },
      ]),
    )!;
    expect(md).toContain('**Error:** `ValueError: boom`');
    expect(md).toContain('ValueError: boom\nvery long frame line');
  });
});

describe('IpynbLoader', () => {
  let loader: FileLoaderInterface;

  beforeEach(() => {
    loader = new IpynbLoader();
  });

  it('should load pages correctly', async () => {
    const pages = await loader.loadPages(fixturePath('test.ipynb'));

    // 1 notebook header block + 5 cells
    expect(pages).toHaveLength(6);
    expect(pages[0].pageContent).toBe(
      '> Jupyter notebook · kernel: Python 3 · language: python 3.11.0',
    );
    expect(pages[1].metadata).toEqual({ chunkIndex: 1, totalChunks: 6 });
  });

  it('should aggregate content correctly', async () => {
    const pages = await loader.loadPages(fixturePath('test.ipynb'));
    const content = await loader.aggregateContent(pages);

    expect(content).toContain('# Sample Notebook');
    expect(content).toContain('**In [1]:**');
    expect(content).toContain('<table><tr><td>1</td></tr></table>');
    expect(content).not.toContain('<style>');
    // the text/plain twin of the html output is dropped
    expect(content).not.toContain('0  1');
    expect(content).toContain('![image/png output — 2 KB, omitted]');
    expect(content).not.toContain('AAAA');
    // progress rewrites keep only the final frame, ansi codes are stripped
    expect(content).toContain('100%|##########');
    expect(content).not.toContain(' 10%');
    expect(content).toContain('done');
  });

  it('should fall back to raw text for non-notebook JSON', async () => {
    const pages = await loader.loadPages(fixturePath('invalid.ipynb'));

    expect(pages).toHaveLength(1);
    expect(pages[0].pageContent.trim()).toBe('{"hello": "world"}');
    expect(pages[0].metadata).toEqual({ lineNumberEnd: 2, lineNumberStart: 1 });
  });
});

describe('convertIpynbToMarkdown hardening', () => {
  const streamCell = (text: string | string[]) => ({
    cell_type: 'code',
    execution_count: 1,
    metadata: {},
    outputs: [{ name: 'stdout', output_type: 'stream', text }],
    source: 'run()',
  });

  it('keeps CRLF stream lines instead of dropping them', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([streamCell(['Accuracy: 0.97\r\n', 'Loss: 0.03\r\n'])]),
    )!;
    expect(md).toContain('Accuracy: 0.97');
    expect(md).toContain('Loss: 0.03');
    expect(md).toContain('**Output:**');
  });

  it('accepts a BOM-prefixed notebook', () => {
    const md = convertIpynbToMarkdown(
      '\uFEFF' + makeNotebook([{ cell_type: 'markdown', metadata: {}, source: '# Title' }]),
    );
    expect(md).not.toBeNull();
    expect(md).toContain('# Title');
  });

  it('returns null for malformed cells instead of throwing', () => {
    expect(convertIpynbToMarkdown('{"nbformat":4,"cells":[null]}')).toBeNull();
    expect(
      convertIpynbToMarkdown(
        '{"nbformat":4,"cells":[{"cell_type":"code","outputs":[null],"source":"x"}]}',
      ),
    ).toBeNull();
  });

  it('preserves text/markdown outputs', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 3,
          metadata: {},
          outputs: [
            {
              data: { 'text/markdown': '## Result\n- accuracy 0.97' },
              metadata: {},
              output_type: 'display_data',
            },
          ],
          source: 'render(report)',
        },
      ]),
    )!;
    expect(md).toContain('**Output:**\n## Result\n- accuracy 0.97');
  });

  it('keeps script-free svg output and replaces script-bearing svg', () => {
    const kept = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 4,
          metadata: {},
          outputs: [
            {
              data: { 'image/svg+xml': '<svg><text>LABEL</text></svg>' },
              metadata: {},
              output_type: 'display_data',
            },
          ],
          source: 'plot()',
        },
      ]),
    )!;
    expect(kept).toContain('<svg><text>LABEL</text></svg>');

    const replaced = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 5,
          metadata: {},
          outputs: [
            {
              data: { 'image/svg+xml': '<svg><script>evil()</script></svg>' },
              metadata: {},
              output_type: 'display_data',
            },
          ],
          source: 'plot()',
        },
      ]),
    )!;
    expect(replaced).toContain('[svg output (script)');
    expect(replaced).not.toContain('<script');
  });

  it('widens code fences when the source contains a fence', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 6,
          metadata: {},
          outputs: [],
          source: '# fenced\n```\nx = 1',
        },
      ]),
    )!;
    expect(md).toContain('````python');
    expect(md).toContain('\n````');
  });

  it('strips unterminated style blocks', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 7,
          metadata: {},
          outputs: [
            {
              data: { 'text/html': '<table><tr><td>DATA</td></tr></table><style>.a{}' },
              metadata: {},
              output_type: 'execute_result',
            },
          ],
          source: 'df',
        },
      ]),
    )!;
    expect(md).toContain('<table><tr><td>DATA</td></tr></table>');
    expect(md).not.toContain('<style>');
    expect(md).not.toContain('.a{}');
  });

  it('strips every escape on pathological OSC-heavy streams', () => {
    const osc = '\u001B]a'.repeat(10_000) + '\u0007\ntail';
    const md = convertIpynbToMarkdown(makeNotebook([streamCell(osc)]))!;
    expect(md).toContain('tail');
    expect(md).not.toContain('\u001B');
    expect(md).not.toContain('\u0007');
  });

  it('keeps the last visible frame when a stream ends in repeated returns', () => {
    const md = convertIpynbToMarkdown(makeNotebook([streamCell('done\r\r')]))!;
    expect(md).toContain('done');
  });

  it('widens fences on a cell with a very large number of runs', () => {
    const body = '# x ```\n'.repeat(50_000);
    const md = convertIpynbToMarkdown(
      makeNotebook([
        { cell_type: 'code', execution_count: 9, metadata: {}, outputs: [], source: body },
      ]),
    );
    expect(md).not.toBeNull();
    expect(md).toContain('````python');
  });

  it('returns null when a cell source has an unreadable shape', () => {
    expect(
      convertIpynbToMarkdown('{"nbformat":4,"cells":[{"cell_type":"markdown","source":42}]}'),
    ).toBeNull();
    expect(convertIpynbToMarkdown('{"nbformat":4,"cells":[{"source":"x"}]}')).toBeNull();
  });

  it('collapses base64 wrapped across a json string array in the fallback helper', () => {
    const lines = Array.from({ length: 27 }, () => 'A'.repeat(76));
    const scrubbed = scrubIpynbFallbackText('{"png": ["' + lines.join('", "') + '"]}');
    expect(scrubbed).not.toContain('AAAA');
    expect(scrubbed).toContain('[base64 payload — 2 KB, omitted]');
  });

  it('leaves short base64-looking strings untouched', () => {
    const short = '{"id": "' + 'A'.repeat(64) + '"}';
    expect(scrubIpynbFallbackText(short)).toBe(short);
  });

  it('collapses long base64 runs in the raw-text fallback helper', () => {
    const scrubbed = scrubIpynbFallbackText('{"png": "' + 'A'.repeat(2048) + '"}');
    expect(scrubbed).not.toContain('AAAA');
    expect(scrubbed).toContain('[base64 payload — 2 KB, omitted]');
  });

  it('strips escapes outside the CSI and OSC families', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        streamCell([
          '\u001B(Bcharset reset\n',
          '\u001B[38:2:255:0:0mtruecolor subparams\u001B[0m\n',
          '\u001Bcterminal reset\n',
        ]),
      ]),
    )!;
    expect(md).not.toContain('\u001B');
    expect(md).toContain('charset reset');
    expect(md).toContain('truecolor subparams');
    expect(md).toContain('terminal reset');
  });

  it('keeps a text/plain-only result as a fenced block', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 4,
          metadata: {},
          outputs: [{ data: { 'text/plain': ['4'] }, metadata: {}, output_type: 'execute_result' }],
          source: '2 + 2',
        },
      ]),
    )!;
    expect(md).toContain('**Output:**\n```\n4\n```');
  });

  it('prefers the image placeholder over its text/plain twin', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 5,
          metadata: {},
          outputs: [
            {
              data: {
                'image/png': 'A'.repeat(1366),
                'text/plain': '<Figure size 640x480 with 1 Axes>',
              },
              metadata: {},
              output_type: 'execute_result',
            },
          ],
          source: 'plt.plot(x)',
        },
      ]),
    )!;
    expect(md).toContain('![image/png output — 1 KB, omitted]');
    expect(md).not.toContain('<Figure');
  });

  it('fences raw cells', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([{ cell_type: 'raw', metadata: {}, source: '.. raw directive\n   body' }]),
    )!;
    expect(md).toContain('```\n.. raw directive\n   body\n```');
  });

  it('scrubs data uris pasted into a markdown cell', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'markdown',
          metadata: {},
          source: '![shot](data:image/png;base64,' + 'V'.repeat(2048) + ')',
        },
      ]),
    )!;
    expect(md).toContain('![shot](data:image/png;base64,[2 KB omitted])');
    expect(md).not.toContain('VVVV');
  });

  it('treats uppercase script tags as script-bearing html', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 6,
          metadata: {},
          outputs: [
            {
              data: { 'text/html': '<div></div><SCRIPT>window.Bokeh = {};</SCRIPT>' },
              metadata: {},
              output_type: 'display_data',
            },
          ],
          source: 'show(p)',
        },
      ]),
    )!;
    expect(md).toContain('[interactive HTML output (script)');
    expect(md).not.toContain('window.Bokeh');
  });

  it('strips styles with attributes and more than one style block', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 7,
          metadata: {},
          outputs: [
            {
              data: {
                'text/html':
                  '<style scoped>.a { color: red; }</style>' +
                  '<table><tr><td>KEEP</td></tr></table>' +
                  '<style type="text/css">.b { color: blue; }</style><p>TAIL</p>',
              },
              metadata: {},
              output_type: 'execute_result',
            },
          ],
          source: 'df.style',
        },
      ]),
    )!;
    expect(md).toContain('<table><tr><td>KEEP</td></tr></table>');
    expect(md).toContain('<p>TAIL</p>');
    expect(md).not.toContain('color: red');
    expect(md).not.toContain('color: blue');
  });

  it('preserves tags that merely start with style', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 9,
          metadata: {},
          outputs: [
            {
              data: {
                'text/html': '<stylesheet>KEEP</stylesheet><styles>ALSO</styles><p>after</p>',
              },
              metadata: {},
              output_type: 'execute_result',
            },
          ],
          source: 'df',
        },
      ]),
    )!;
    expect(md).toContain('<stylesheet>KEEP</stylesheet>');
    expect(md).toContain('<styles>ALSO</styles>');
    expect(md).toContain('<p>after</p>');
  });

  it('keeps indices aligned when the html contains case-expanding unicode', () => {
    // Turkish dotted I expands to two code units under toLowerCase, so any
    // scanner that lowercases a copy for indexOf desynchronizes its slices.
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 9,
          metadata: {},
          outputs: [
            {
              data: {
                'text/html':
                  '<p>' + '\u0130'.repeat(10) + 'KEEP</p><style>.x{color:red}</style><p>TAIL</p>',
              },
              metadata: {},
              output_type: 'execute_result',
            },
          ],
          source: 'df',
        },
      ]),
    )!;
    expect(md).toContain('KEEP</p><p>TAIL</p>');
    expect(md).not.toContain('color:red');
  });

  it('survives a pathological run of style openers in linear time', () => {
    // 120k bare openers with no closing bracket: a quadratic scanner blows the
    // test timeout here, and none of them is a complete tag so all survive.
    const html = '<style'.repeat(120_000);
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 9,
          metadata: {},
          outputs: [{ data: { 'text/html': html }, metadata: {}, output_type: 'execute_result' }],
          source: 'df',
        },
      ]),
    )!;
    expect(md).toContain('<style<style');
  });

  it('strips a very large number of terminated style blocks', () => {
    const html = '<style>.x{color:red}</style>a'.repeat(50_000) + '<p>END</p>';
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 9,
          metadata: {},
          outputs: [{ data: { 'text/html': html }, metadata: {}, output_type: 'execute_result' }],
          source: 'df',
        },
      ]),
    )!;
    expect(md).toContain('<p>END</p>');
    expect(md).not.toContain('color:red');
    expect(md).toContain('aaaa');
  });

  it('keeps base64-alphabet text lines intact in the fallback helper', () => {
    // Sixteen 64-char hex digests joined by escaped newlines: base64-alphabet
    // only, but not the fixed 76-column wrapping base64.encodebytes emits.
    const digests = Array.from({ length: 16 }, () => 'abcdef0123456789'.repeat(4)).join('\\n');
    const raw = '{"hashes": "' + digests + '"}';
    expect(scrubIpynbFallbackText(raw)).toBe(raw);
  });

  it('merges array elements that end with an escaped newline', () => {
    // v3 split_lines-style arrays keep the newline at the end of every
    // element, so two separators sit back to back between payload runs.
    const line = 'A'.repeat(76);
    const raw = '{"png":["' + Array.from({ length: 14 }, () => line + '\\n').join('", "') + '"]}';
    const scrubbed = scrubIpynbFallbackText(raw);
    expect(scrubbed).toContain('[base64 payload — 798 B, omitted]');
    expect(scrubbed).not.toContain('AAAA');
  });

  it('merges 76-column payloads wrapped with physical newlines', () => {
    // An invalid-JSON file is scrubbed as plain text, where encodebytes
    // output is wrapped with real newlines rather than escaped ones.
    const raw = Array.from({ length: 20 }, () => 'A'.repeat(76)).join('\n');
    const scrubbed = scrubIpynbFallbackText(raw);
    expect(scrubbed).toContain('[base64 payload — 1 KB, omitted]');
    expect(scrubbed).not.toContain('AAAA');
  });

  it('keeps a json array of hex digests intact in the fallback helper', () => {
    // Quoted-array separators join base64-alphabet runs too, so the fixed
    // 76-column rule has to apply there as well or a digest list is deleted.
    const digest = 'abcdef0123456789'.repeat(4);
    const raw = '{"hashes": ["' + Array.from({ length: 16 }, () => digest).join('", "') + '"]}';
    expect(scrubIpynbFallbackText(raw)).toBe(raw);
  });

  it('collapses 76-column payloads regardless of the separator kind', () => {
    // 15 lines of 76 chars alternating escaped newlines and quoted-array
    // separators: still the canonical wrapped shape, still one blob.
    const line = 'A'.repeat(76);
    const parts: string[] = [];
    for (let index = 0; index < 15; index++) {
      parts.push(line, index % 2 === 0 ? '\\n' : '", "');
    }
    parts.pop();
    const scrubbed = scrubIpynbFallbackText('{"png": "' + parts.join('') + '"}');
    expect(scrubbed).toContain('[base64 payload — 855 B, omitted]');
    expect(scrubbed).not.toContain('AAAA');
  });

  it('reports the exact byte size of newline-wrapped payloads', () => {
    // 15 lines of 76 chars = 1140 payload chars -> floor(1140 * 3 / 4) = 855.
    // The two-character escapes are separators and must not count as payload.
    const wrapped = Array.from({ length: 15 }, () => 'A'.repeat(76)).join('\\n');
    const scrubbed = scrubIpynbFallbackText('{"png": "' + wrapped + '"}');
    expect(scrubbed).toContain('[base64 payload — 855 B, omitted]');
    expect(scrubbed).not.toContain('AAAA');
  });

  it('discounts trailing padding from reported base64 sizes', () => {
    // A valid padded payload: 1364 chars (a multiple of four) ending in '=='
    // decode to 1364 * 3 / 4 - 2 = 1021 bytes.
    const scrubbed = scrubIpynbFallbackText('{"blob": "' + 'Q'.repeat(1362) + '=="}');
    expect(scrubbed).toContain('[base64 payload — 1021 B, omitted]');
  });

  it('never reports a negative size for an equals-sign flood', () => {
    // '=' x 1024 is garbage; trailing padding is capped at two so the size
    // stays positive, and the exact figure is not part of the contract.
    const scrubbed = scrubIpynbFallbackText('{"x": "' + '='.repeat(1024) + '"}');
    expect(scrubbed).toMatch(/\[base64 payload — \d+ B, omitted\]/);
  });

  it('scrubs data uris with media-type parameters or uppercase markers', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'markdown',
          metadata: {},
          source:
            '![a](data:image/png;charset=utf-8;base64,' +
            'V'.repeat(2048) +
            ') ![b](DATA:image/png;BASE64,' +
            'W'.repeat(2048) +
            ')',
        },
      ]),
    )!;
    expect(md).not.toContain('VVVV');
    expect(md).not.toContain('WWWW');
    expect((md.match(/omitted/g) ?? []).length).toBe(2);
  });

  it('scrubs data uris with any number of media-type parameters', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'markdown',
          metadata: {},
          source: '![x](data:image/png;a=1;b=2;c=3;d=4;e=5;base64,' + 'V'.repeat(2048) + ')',
        },
      ]),
    )!;
    expect(md).not.toContain('VVVV');
    expect(md).toContain('omitted');
  });

  it('scrubs data uris whose parameters use the full rfc 2045 token grammar', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'markdown',
          metadata: {},
          source:
            "![a](data:image/png;name=O'Reilly;base64," +
            'V'.repeat(2048) +
            ') ![b](data:application/x.foo~bar;base64,' +
            'W'.repeat(2048) +
            ') ![c](data:image/png;comment=' +
            'x'.repeat(300) +
            ';base64,' +
            'Y'.repeat(2048) +
            ')',
        },
      ]),
    )!;
    expect(md).not.toContain('VVVV');
    expect(md).not.toContain('WWWW');
    expect(md).not.toContain('YYYY');
    expect((md.match(/omitted/g) ?? []).length).toBe(3);
  });

  it('keeps the code fence intact when notebook metadata is adversarial', () => {
    const md = convertIpynbToMarkdown(
      JSON.stringify({
        cells: [
          { cell_type: 'code', execution_count: 1, metadata: {}, outputs: [], source: 'safe()' },
        ],
        metadata: { language_info: { name: 'python\n```\n# injected' } },
        nbformat: 4,
      }),
    )!;
    expect(md).toContain('```python\nsafe()\n```');
    expect(md.split('\n')[0]).toBe('> Jupyter notebook · language: python # injected');
  });

  it('falls back when a source array contains non-strings', () => {
    expect(
      convertIpynbToMarkdown(
        '{"nbformat":4,"cells":[{"cell_type":"markdown","source":[{"critical":"x"}]}]}',
      ),
    ).toBeNull();
  });

  it('removes bell characters and bounds runaway osc bodies', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([streamCell('\u001B]0;' + 'A'.repeat(260) + '\u0007tail')]),
    )!;
    expect(md).not.toContain('\u001B');
    expect(md).not.toContain('\u0007');
    // The 256-char body bound consumes escape and bell bytes but must keep the
    // overflow text itself.
    expect(md).toContain('AAAAtail');
  });

  it('preserves the source of forward-compatible cell types', () => {
    const md = convertIpynbToMarkdown(
      '{"nbformat":4,"cells":[{"cell_type":"future","source":"SECRET"}]}',
    )!;
    expect(md).toContain('```\nSECRET\n```');
  });

  it('falls back when nbformat is missing or not an integer', () => {
    // nbformat is a required integer field; a stringly-typed or absent one is
    // not a saved v4 notebook, and treating it as one would let an unknown
    // cell smuggle an unscrubbed payload past the raw-text fallback.
    expect(convertIpynbToMarkdown('{"cells":[{"cell_type":"markdown","source":"hi"}]}')).toBeNull();
    expect(
      convertIpynbToMarkdown('{"nbformat":"3","cells":[{"cell_type":"future","source":"x"}]}'),
    ).toBeNull();
    for (const bad of ['"4"', '4.5', 'true', '[4]']) {
      expect(
        convertIpynbToMarkdown(
          '{"nbformat":' + bad + ',"cells":[{"cell_type":"markdown","source":"hi"}]}',
        ),
      ).toBeNull();
    }
  });

  it('drops non-string elements from output text instead of rendering them', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 1,
          metadata: {},
          outputs: [{ name: 'stdout', output_type: 'stream', text: ['ok', { critical: 'x' }] }],
          source: 'x',
        },
      ]),
    )!;
    expect(md).toContain('ok');
    expect(md).not.toContain('object Object');
  });

  it('accepts whitespace before the closing style bracket', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 9,
          metadata: {},
          outputs: [
            {
              data: { 'text/html': '<style>.s{color:red}</style ><p>KEEP</p>' },
              metadata: {},
              output_type: 'execute_result',
            },
          ],
          source: 'df',
        },
      ]),
    )!;
    expect(md).toContain('<p>KEEP</p>');
    expect(md).not.toContain('color:red');
  });

  it('preserves tags that merely start with script', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 9,
          metadata: {},
          outputs: [
            {
              data: { 'text/html': '<scripture>KEEP</scripture>' },
              metadata: {},
              output_type: 'execute_result',
            },
          ],
          source: 'df',
        },
      ]),
    )!;
    expect(md).toContain('<scripture>KEEP</scripture>');
  });

  it('treats non-ascii whitespace as content, not a tag boundary', () => {
    // U+00A0 after `<script` or inside `</style >` is not HTML whitespace:
    // the former is plain content and the latter does not close the tag.
    const nbspScript = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 9,
          metadata: {},
          outputs: [
            {
              data: { 'text/html': '<script\u00A0x>KEEP</script\u00A0x>' },
              metadata: {},
              output_type: 'execute_result',
            },
          ],
          source: 'df',
        },
      ]),
    )!;
    expect(nbspScript).toContain('KEEP');

    const nbspStyle = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 9,
          metadata: {},
          outputs: [
            {
              data: { 'text/html': '<style>x</style\u00A0><p>GONE</p>' },
              metadata: {},
              output_type: 'execute_result',
            },
          ],
          source: 'df',
        },
      ]),
    )!;
    expect(nbspStyle).not.toContain('GONE');
  });

  it('strips an osc body terminated by the 8-bit st', () => {
    // The short body proves the ST byte ends the body scan: without the
    // exclusion the body would swallow the terminator and TAIL with it.
    const md = convertIpynbToMarkdown(makeNotebook([streamCell('\u001B]0;title\u009CTAIL')]))!;
    expect(md).toContain('TAIL');
    expect(md).not.toContain('title');
    expect(md).not.toContain('\u009C');

    // An over-long body hits the 256-char bound instead: escape and both
    // terminator bytes still vanish while the overflow text survives.
    const long = convertIpynbToMarkdown(
      makeNotebook([streamCell('\u001B]0;' + 'A'.repeat(255) + '\u009CTAIL')]),
    )!;
    expect(long).toContain('TAIL');
    expect(long).not.toContain('\u009C');
    expect(long).not.toContain('AAAA');
  });

  it('reports multiline array image payload sizes without their newlines', () => {
    const line = 'A'.repeat(76) + '\n';
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 9,
          metadata: {},
          outputs: [
            {
              data: { 'image/png': Array.from({ length: 14 }, () => line) },
              metadata: {},
              output_type: 'display_data',
            },
          ],
          source: 'plt.show()',
        },
      ]),
    )!;
    expect(md).toContain('![image/png output — 798 B, omitted]');
  });

  it('keeps text/latex outputs fenced', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 10,
          metadata: {},
          outputs: [
            {
              data: { 'text/latex': '$e^{i\\pi}=-1$' },
              metadata: {},
              output_type: 'execute_result',
            },
          ],
          source: 'expr',
        },
      ]),
    )!;
    expect(md).toContain('**Output:**\n```\n$e^{i\\pi}=-1$\n```');
  });

  it('reports the exact svg script placeholder', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 11,
          metadata: {},
          outputs: [
            {
              data: { 'image/svg+xml': '<svg><SCRIPT>a</SCRIPT></svg>' },
              metadata: {},
              output_type: 'display_data',
            },
          ],
          source: 'plot()',
        },
      ]),
    )!;
    expect(md).toContain('`[svg output (script) — 29 chars, omitted]`');
  });

  it('reports script placeholder sizes in characters', () => {
    const html = '<script>' + 'x'.repeat(500) + '</script>';
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 11,
          metadata: {},
          outputs: [{ data: { 'text/html': html }, metadata: {}, output_type: 'display_data' }],
          source: 'fig.show()',
        },
      ]),
    )!;
    expect(md).toContain('`[interactive HTML output (script) — 517 chars, omitted]`');
  });

  it('widens the fence past a four-backtick run inside the source', () => {
    const md = convertIpynbToMarkdown(
      makeNotebook([
        {
          cell_type: 'code',
          execution_count: 8,
          metadata: {},
          outputs: [],
          source: 'text = """\n````\n"""',
        },
      ]),
    )!;
    expect(md).toContain('`````python\n');
    expect(md).toContain('\n`````');
  });
});

describe('IpynbLoader fallbacks', () => {
  let loader: FileLoaderInterface;

  beforeEach(() => {
    loader = new IpynbLoader();
  });

  it('falls back to scrubbed raw text for legacy v3 notebooks', async () => {
    const pages = await loader.loadPages(fixturePath('legacy-v3.ipynb'));
    expect(pages).toHaveLength(1);
    expect(pages[0].pageContent).not.toContain('AAAA');
    expect(pages[0].pageContent).toContain('[base64 payload —');
    expect(pages[0].pageContent).toContain('"nbformat": 3');
  });

  it('rejects binary content masquerading as a notebook', async () => {
    await expect(loader.loadPages(fixturePath('binary.ipynb'))).rejects.toThrow(
      /Binary content in \.ipynb file: \d+(\.\d+)?% non-printable chars/,
    );
  });
});
