import { readFile } from 'node:fs/promises';

import debug from 'debug';

import type { DocumentPage, FileLoaderInterface } from '../../types';
import { sniffBinaryBuffer } from '../../utils/isBinaryContent';

const log = debug('file-loaders:ipynb');

/**
 * `<script` must open a real tag — `<scripture>` is content, not a script.
 * The boundary set is the HTML tokenizer's ASCII whitespace (TAB/LF/FF/CR/
 * SPACE) plus `/` and `>`; JavaScript `\\s` would wrongly admit NBSP.
 */
const SCRIPT_TAG_RE = /<script[\t\n\f\r />]/i;

/* Minimal nbformat v4 shapes (https://nbformat.readthedocs.io/en/latest/format_description.html) */
interface NotebookOutput {
  data?: Record<string, unknown>;
  ename?: string;
  evalue?: string;
  output_type: string;
  text?: string | string[];
  traceback?: string[];
}

interface NotebookCell {
  cell_type: string;
  execution_count?: number | null;
  outputs?: NotebookOutput[];
  source?: string | string[];
}

interface Notebook {
  cells?: NotebookCell[];
  metadata?: {
    kernelspec?: { display_name?: string; name?: string };
    language_info?: { name?: string; version?: string };
  };
  nbformat?: number;
}

/**
 * Escape sequences, in match order: CSI (parameter bytes include `:`
 * subparameters and the final byte is any of `@`-`~`), OSC terminated by BEL /
 * ST (or end of input), the two-byte families (charset designation such as
 * `ESC ( B`, plus Fp/Fs sequences such as `ESC c`), and finally a bare escape
 * so none can survive into the text, plus stray BEL and C1 ST bytes (the
 * terminators an over-long OSC body leaves behind). The OSC body excludes further escapes and
 * every other branch is length-bounded, so one unterminated sequence cannot
 * make the scan quadratic over the remaining text.
 */
const ANSI_RE =
  /\u001B\[[\d:;?]*[\u0020-\u002F]*[\u0040-\u007E]|\u001B\][^\u0007\u001B\u009C]{0,256}(?:\u0007|\u001B\\)?|\u001B[\u0021-\u002F]{0,2}[\u0030-\u007E]|\u001B|\u0007|\u009C/g;
/**
 * RFC 2397 data URIs: the scheme is case-insensitive, the media type and
 * any number of `;attribute=value` parameters use the RFC 2045 token
 * grammar (everything but tspecials, space and controls — so apostrophes
 * and tildes are legal), and all of it must be matched or a valid URI
 * slips past the scrub. `;` is a tspecial, so each parameter is consumed
 * exactly once and the scan stays linear.
 */
const MIME_TOKEN = '[^\\s()<>@,;:\\\\"/\\[\\]?=]+';
const DATA_URI_RE = new RegExp(
  `data:(${MIME_TOKEN}/${MIME_TOKEN})?(?:;${MIME_TOKEN}=${MIME_TOKEN})*;base64,([\\d+/=A-Za-z]{256,})`,
  'gi',
);
/**
 * A base64 payload in raw text appears as one contiguous run, a run split
 * across a JSON string array, or a run wrapped by newlines — escaped
 * (`base64.encodebytes` output inside JSON) or physical (the same output in
 * a plain file). Array elements can end with an escaped newline, so runs of
 * consecutive separators count as one boundary.
 */
const BASE64_RUN_RE = /[\d+/=A-Za-z]{32,}(?:(?:"[\s,]*"|\\n|\r?\n)+[\d+/=A-Za-z]{32,})*/g;
/** The same separator runs, captured, so a split keeps them byte for byte. */
const BASE64_SEPARATOR_RE = /((?:"[\s,]*"|\\n|\r?\n)+)/;
const NON_BASE64_RE = /[^\d+/=A-Za-z]/g;
const BASE64_SCRUB_THRESHOLD = 1024;

/**
 * nbformat stores text as either a string or a list of line strings. Output
 * values are not validated up front the way cell sources are, so non-string
 * list elements are dropped here rather than rendered as `[object Object]`.
 */
const joinSource = (source?: unknown): string =>
  Array.isArray(source)
    ? source.filter((part): part is string => typeof part === 'string').join('')
    : typeof source === 'string'
      ? source
      : '';

/**
 * Strip ANSI escapes and collapse carriage-return progress rewrites. tqdm and
 * friends redraw the same line via `\r`; Jupyter renders only the final state,
 * so keeping the text after the last `\r` of each line reproduces exactly what
 * the notebook displays while dropping the invisible intermediate frames.
 * CRLF line endings are normalized first so they read as plain newlines
 * instead of empty rewrite frames, and a trailing `\r` keeps its last
 * non-empty frame.
 */
const cleanStreamText = (text: string): string =>
  text
    .replaceAll(ANSI_RE, '')
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => {
      // Keep the last frame that actually rendered something, so a stream
      // ending in one or more bare carriage returns does not lose its text.
      const frames = line.split('\r').filter((frame) => frame !== '');
      return frames.at(-1) ?? '';
    })
    .join('\n');

/**
 * Strip `<style>…</style>` blocks with a single forward scan. `<style` must
 * be followed by whitespace, `/` or `>` so tags that merely start with the
 * word (`<stylesheet>`) survive, the closing tag may carry whitespace before
 * its bracket, and an unterminated opener drops the rest of the string,
 * matching how a browser parses it. A regex with `[^>]*` here is
 * quadratic on repeated openers — each candidate rescans the remaining
 * suffix — so the scan is done with indexOf instead.
 */
const STYLE_BOUNDARY = new Set([9, 10, 12, 13, 32, 47, 62]); // ws, /, >
const stripStyleTags = (html: string): string => {
  // Literal sticky searches on the original string: lowercasing a copy for
  // indexOf would desynchronize indices, because toLowerCase can change the
  // string length (Turkish dotted I expands to two code units).
  const openRe = /<style/gi;
  const closeRe = /<\/style[\t\n\f\r ]*>/gi;
  let result = '';
  let pos = 0;
  while (pos < html.length) {
    openRe.lastIndex = pos;
    const open = openRe.exec(html);
    if (open === null) {
      result += html.slice(pos);
      break;
    }
    if (!STYLE_BOUNDARY.has(html.charCodeAt(open.index + 6))) {
      result += html.slice(pos, open.index + 6);
      pos = open.index + 6;
      continue;
    }
    result += html.slice(pos, open.index);
    closeRe.lastIndex = open.index;
    const close = closeRe.exec(html);
    if (close === null) break;
    pos = close.index + close[0].length;
  }
  return result;
};

const humanSize = (bytes: number): string =>
  bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;

/** Markup placeholders report character counts — the text was never base64. */
const humanChars = (chars: number): string =>
  chars >= 1024 ? `${Math.round(chars / 1024)}k chars` : `${chars} chars`;

/**
 * Decoded byte count of a base64 payload. Whitespace and other stray bytes
 * are not payload, and only the trailing `=` run counts as padding — capped
 * at two, because a valid payload never carries more.
 */
const base64Bytes = (payload: string): number => {
  const clean = payload.replaceAll(NON_BASE64_RE, '');
  const padding = Math.min(2, (clean.match(/=*$/) ?? [''])[0].length);
  return Math.floor((clean.length * 3) / 4) - padding;
};

/**
 * Replace long base64 `data:` URIs with a sized placeholder while keeping the
 * surrounding markup. IPython.display.Audio/Image/Video embed their payload as
 * a data URI inside otherwise script-free HTML (e.g. `<audio><source
 * src="data:audio/wav;base64,...">`), which would slip past the script guard.
 * Short data URIs (tiny inline icons) are left alone.
 */
const scrubDataUris = (text: string): string =>
  text.replaceAll(
    DATA_URI_RE,
    (_match, mime, payload) =>
      `data:${mime ?? 'unknown'};base64,[${humanSize(base64Bytes(payload))} omitted]`,
  );

/**
 * Fallback used when the input is not convertible notebook JSON: keep the raw
 * text readable but collapse long base64 runs (embedded images/audio) into
 * sized placeholders so an unconvertible notebook cannot flood the context
 * with undecodable payload. Exported for the chunking pipeline, which needs
 * the same guarantee on its raw-text fallback path.
 */
const base64Placeholder = (payload: string): string =>
  `[base64 payload — ${humanSize(base64Bytes(payload))}, omitted]`;

export const scrubIpynbFallbackText = (raw: string): string =>
  raw.replaceAll(BASE64_RUN_RE, (match) => {
    // Splitting on the captured separators leaves the pure base64 segments
    // at the even indices and the separators themselves at the odd ones, so
    // untouched parts are re-emitted byte for byte.
    const parts = match.split(BASE64_SEPARATOR_RE);
    if (parts.length > 1) {
      // A separated payload is merged into one blob only in the fixed
      // 76-column shape `base64.encodebytes` emits — regardless of the
      // separator kind. Anything else — say a JSON array of 64-char hex
      // digests, which is base64-alphabet-only data — is judged segment by
      // segment so surrounding content is never swallowed.
      const segments = parts.filter((_, index) => index % 2 === 0);
      const payload = segments.join('');
      const wrapped = segments.slice(0, -1).every((segment) => segment.length === 76);
      if (wrapped && payload.length >= BASE64_SCRUB_THRESHOLD) return base64Placeholder(payload);
      return parts
        .map((part, index) =>
          index % 2 === 0 && part.length >= BASE64_SCRUB_THRESHOLD ? base64Placeholder(part) : part,
        )
        .join('');
    }
    if (match.length < BASE64_SCRUB_THRESHOLD) return match;
    return base64Placeholder(match);
  });

/** Collapse metadata text to one fence-safe line for the header blockquote. */
const singleLine = (text: string): string => text.replaceAll(/[`\r\n]+/g, ' ').trim();

/** Fenced code block whose fence is longer than any backtick run inside. */
const fence = (body: string, language = ''): string => {
  // Iterative max: spreading a match list of many thousands of runs into
  // Math.max would overflow the call stack on a pathological cell.
  let longest = 0;
  for (const run of body.match(/`{3,}/g) ?? []) if (run.length > longest) longest = run.length;
  const ticks = '`'.repeat(longest > 0 ? longest + 1 : 3);
  return [ticks + language, body, ticks].join('\n');
};

const convertOutput = (output: NotebookOutput): string => {
  switch (output.output_type) {
    case 'stream': {
      const body = cleanStreamText(joinSource(output.text));
      return body.trim() ? fence(body) : '';
    }

    case 'error': {
      // Tracebacks are kept in full — only ANSI color codes are removed.
      const traceback = cleanStreamText(
        (Array.isArray(output.traceback) ? output.traceback : [])
          .filter((line): line is string => typeof line === 'string')
          .join('\n'),
      );
      return [
        `**Error:** \`${output.ename ?? ''}: ${output.evalue ?? ''}\``,
        fence(traceback),
      ].join('\n');
    }

    case 'display_data':
    case 'execute_result': {
      const data = output.data ?? {};

      // Widget views only carry a model id; the (potentially multi-MB) state
      // blob lives in notebook-level metadata, which this loader never emits.
      if ('application/vnd.jupyter.widget-view+json' in data)
        return '`[interactive widget — omitted]`';

      const html = data['text/html'];
      if (html !== undefined) {
        const htmlText = joinSource(html);
        // Script-bearing HTML (plotly / bokeh / folium) embeds whole JS
        // bundles — exactly the token blowup this loader exists to avoid.
        // Script-free HTML (pandas tables) stays, minus its <style> block.
        if (SCRIPT_TAG_RE.test(htmlText))
          return `\`[interactive HTML output (script) — ${humanChars(htmlText.length)}, omitted]\``;
        // `text/plain` twin (pandas emits both) is intentionally dropped here.
        return scrubDataUris(stripStyleTags(htmlText)).trim();
      }

      // SVG output (matplotlib's svg backend) is fully readable markup —
      // keep it under the same script guard as HTML.
      const svg = data['image/svg+xml'];
      if (svg !== undefined) {
        const svgText = joinSource(svg);
        if (SCRIPT_TAG_RE.test(svgText))
          return `\`[svg output (script) — ${humanChars(svgText.length)}, omitted]\``;
        return scrubDataUris(svgText).trim();
      }

      for (const mime of Object.keys(data)) {
        if (mime.startsWith('image/')) {
          // Embedded output images are anonymous base64 — unreadable as text
          // tokens for an LLM, so record that one existed and its weight.
          const size = base64Bytes(joinSource(data[mime]));
          return `![${mime} output — ${humanSize(size)}, omitted]`;
        }
      }

      // Markdown renders as-is; any other textual mime is kept fenced.
      const markdown = data['text/markdown'];
      if (markdown !== undefined) return scrubDataUris(joinSource(markdown));

      for (const mime of Object.keys(data)) {
        if (mime.startsWith('text/')) {
          const body = joinSource(data[mime]);
          return body.trim() ? fence(body) : '';
        }
      }

      const mimes = Object.keys(data).join(', ');
      return `\`[${mimes || 'unknown'} output — omitted]\``;
    }

    default: {
      return '';
    }
  }
};

/**
 * nbformat requires a string `cell_type` and a string / string-list `source`.
 * Anything else is malformed: the caller falls back to raw text rather than
 * silently emitting a cell whose content could not be read.
 */
const isNotebookCell = (cell: unknown): cell is NotebookCell => {
  if (!cell || typeof cell !== 'object') return false;
  const { cell_type: cellType, source } = cell as NotebookCell;
  if (typeof cellType !== 'string') return false;
  return (
    source === undefined ||
    typeof source === 'string' ||
    // Every element must be a string — `joinSource` would otherwise render
    // objects as `[object Object]`, silently destroying the cell.
    (Array.isArray(source) && source.every((part) => typeof part === 'string'))
  );
};

/** Convert one notebook cell into a markdown block (`undefined` → skip). */
const convertCell = (cell: NotebookCell, language: string): string | undefined => {
  const source = joinSource(cell.source);

  switch (cell.cell_type) {
    case 'markdown': {
      // Attachment payloads (base64 dict) are simply never emitted; the
      // `![](attachment:name)` references in the source keep the image names.
      // Inline data URIs pasted directly into the cell are scrubbed the same
      // way as HTML outputs.
      return scrubDataUris(source);
    }

    case 'raw': {
      return fence(scrubDataUris(source));
    }

    case 'code': {
      const header = `**In [${cell.execution_count ?? ' '}]:**`;
      const blocks = [`${header}\n${fence(source, language)}`];
      const outputs = (cell.outputs ?? []).map(convertOutput).filter(Boolean);
      if (outputs.length > 0) blocks.push(`**Output:**\n${outputs.join('\n\n')}`);
      return blocks.join('\n\n');
    }

    default: {
      // nbformat allows forward-compatible cell types; their source is still
      // a multiline string, so preserving it fenced beats deleting the cell.
      return source.trim() ? fence(scrubDataUris(source)) : undefined;
    }
  }
};

/**
 * Convert a Jupyter notebook (nbformat v4 JSON) into markdown blocks, one per
 * cell (plus a one-line kernel/language header). Returns `null` when the input
 * is not v4-compatible notebook JSON — or when any cell is malformed — so
 * callers can fall back to plain text.
 */
const convertIpynbToBlocks = (raw: string): string[] | null => {
  let notebook: Notebook;
  try {
    // A UTF-8 BOM would make JSON.parse throw; strip it like TextDecoder does.
    notebook = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (!notebook || typeof notebook !== 'object' || !Array.isArray(notebook.cells)) return null;
  // nbformat is a required integer field; legacy v3 (and anything that is
  // not a saved v4+ notebook) falls back to scrubbed raw text instead.
  if (!Number.isInteger(notebook.nbformat) || (notebook.nbformat as number) < 4) return null;
  if (!notebook.cells.every(isNotebookCell)) return null;

  try {
    const languageInfo = notebook.metadata?.language_info;
    const languageName = typeof languageInfo?.name === 'string' ? languageInfo.name : undefined;
    // The fence info string renders verbatim, so it is reduced to one safe
    // leading token — notebook metadata must not be able to close the fence.
    const language = languageName?.match(/^[\w#+.-]+/)?.[0] ?? 'python';
    const kernel =
      notebook.metadata?.kernelspec?.display_name ?? notebook.metadata?.kernelspec?.name;

    const headerBits = ['Jupyter notebook'];
    if (typeof kernel === 'string' && kernel) headerBits.push(`kernel: ${singleLine(kernel)}`);
    if (languageName)
      headerBits.push(
        `language: ${singleLine(languageName)}${
          typeof languageInfo?.version === 'string' && languageInfo.version
            ? ` ${singleLine(languageInfo.version)}`
            : ''
        }`,
      );

    const blocks = [`> ${headerBits.join(' · ')}`];
    for (const cell of notebook.cells) {
      const block = convertCell(cell, language);
      if (block !== undefined && block.trim()) blocks.push(block);
    }
    return blocks;
  } catch {
    // Malformed cells/outputs (e.g. null entries) — treat as non-convertible.
    return null;
  }
};

/**
 * Full-document variant of {@link convertIpynbToBlocks}. Exported for the
 * chunking pipeline (`src/libs/document-loaders`), which converts the notebook
 * to markdown and then reuses the markdown splitter.
 */
export const convertIpynbToMarkdown = (raw: string): string | null => {
  const blocks = convertIpynbToBlocks(raw);
  return blocks === null ? null : blocks.join('\n\n');
};

/**
 * Raised when the file is not text at all. `loadFile` only copies errors it
 * catches itself into `FileDocument.metadata.error`, and the local `readFile`
 * tool decides success from that field, so this rejection has to escape
 * `loadPages` instead of being reported as a page-level error.
 */
class BinaryNotebookError extends Error {}

/**
 * Loader for Jupyter notebooks (.ipynb). Preserves code/markdown/raw cell
 * sources and textual outputs while replacing token-heavy payloads (base64
 * images and long inline data URIs, widget state, HTML/SVG that carries a
 * `<script>` tag) with short placeholders.
 */
export class IpynbLoader implements FileLoaderInterface {
  async loadPages(filePath: string): Promise<DocumentPage[]> {
    log('Loading ipynb file:', filePath);
    try {
      const buffer = await readFile(filePath);

      // A renamed binary would otherwise flow through the raw-text fallback;
      // apply the same sniff the plain-text path uses.
      const sniff = sniffBinaryBuffer(buffer.subarray(0, 8192));
      if (sniff.isBinary) {
        log('Rejecting binary content: %s', sniff.reason);
        throw new BinaryNotebookError(`Binary content in .ipynb file: ${sniff.reason}`);
      }

      const raw = buffer.toString('utf8').replace(/^\uFEFF/, '');
      const blocks = convertIpynbToBlocks(raw);

      if (blocks === null) {
        // Not valid nbformat v4 JSON — keep the upload usable as plain text,
        // minus any embedded base64 payloads.
        log('Not nbformat v4 JSON, falling back to scrubbed raw text');
        const fallback = scrubIpynbFallbackText(raw);
        const lines = fallback.split('\n');
        return [
          {
            charCount: fallback.length,
            lineCount: lines.length,
            metadata: { lineNumberEnd: lines.length, lineNumberStart: 1 },
            pageContent: fallback,
          },
        ];
      }

      log('Converted notebook into %d blocks', blocks.length);
      return blocks.map((block, index) => ({
        charCount: block.length,
        lineCount: block.split('\n').length,
        metadata: { chunkIndex: index, totalChunks: blocks.length },
        pageContent: block,
      }));
    } catch (e) {
      const error = e as Error;
      if (error instanceof BinaryNotebookError) throw error;
      console.error(`Error loading ipynb file ${filePath}: ${error.message}`);
      return [
        {
          charCount: 0,
          lineCount: 0,
          metadata: { error: `Failed to load ipynb file: ${error.message}` },
          pageContent: '',
        },
      ];
    }
  }

  async aggregateContent(pages: DocumentPage[]): Promise<string> {
    return pages.map((page) => page.pageContent).join('\n\n');
  }
}
