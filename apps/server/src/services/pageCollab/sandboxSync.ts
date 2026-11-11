import { createHash } from 'node:crypto';

import type { ISandboxService, SandboxCallToolResult } from '@lobechat/builtin-tool-cloud-sandbox';
import {
  diffLiteXMLBlocks,
  EditorRuntime,
  formatModifyNodesResult,
  type LiteXMLBlockDiffSummary,
  type ModifyOperation,
  parseLiteXMLBlocks,
} from '@lobechat/editor-runtime';

import { withHeadlessEditorLock } from '@/server/services/agentDocuments/headlessEditor';

import { runPageExclusive } from './queue';
import {
  PageChangedError,
  type PageSession,
  type PageSessions,
  PageUnsupportedError,
} from './session';

export const PAGE_DIR = '/mnt/page';

const SYNCED_TOOLS = new Set(['execScript', 'runCommand']);
const SYNCED_FILES = ['doc.xml', 'title'] as const;
type SyncedFile = (typeof SYNCED_FILES)[number];

const MIN_SIZE_LIMIT = 2 * 1024 * 1024;

const toBase64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const fromBase64 = (text: string) =>
  Buffer.from(text.replaceAll(/\s/g, ''), 'base64').toString('utf8');

const heredoc = (path: string, text: string, tag: string) =>
  `base64 -d > "${path}" <<'${tag}'\n${toBase64(text)}\n${tag}`;

/**
 * The sandbox runs a command as a single `sh -c` argument, and Linux refuses
 * any one exec argument of 128 KiB or more (MAX_ARG_STRLEN) with E2BIG. The
 * page used to ride inside that argument, so past roughly 90 KB of LiteXML
 * every command failed before the shell started and /mnt/page never appeared.
 * A page whose files would push the wrapper past this budget is staged in the
 * sandbox by separate commands instead.
 */
export const INLINE_PAGE_LIMIT = 64 * 1024;

/**
 * Upper bound of one staging command. It stays clear of the 128 KiB argument
 * limit with room for the `lh` prelude, which is added after this wrapper.
 */
export const STAGE_COMMAND_LIMIT = 96 * 1024;

const pageFileNames = ['doc.xml', 'title', '.meta/outline'] as const;

interface PageFiles {
  outline: string;
  title: string;
  xml: string;
}

const pageFileTexts = (files: PageFiles): Record<(typeof pageFileNames)[number], string> => ({
  '.meta/outline': files.outline,
  'doc.xml': files.xml,
  'title': `${files.title}\n`,
});

const stagedName = (file: string) => file.replaceAll('/', '_');

/** Names the staged copy, so a page that did not change is sent only once. */
export const pageStageKey = (files: PageFiles) => {
  const hash = createHash('sha256');
  for (const text of Object.values(pageFileTexts(files))) hash.update(text).update('\0');
  return hash.digest('hex').slice(0, 32);
};

export const buildOutline = (xml: string) => {
  const blocks = parseLiteXMLBlocks(xml);
  if (typeof blocks === 'string' || blocks.length === 0) return '';
  return `${blocks.map(({ id, tag, text }) => `${id ?? '-'} ${tag} ${text.slice(0, 80)}`.trim()).join('\n')}\n`;
};

/**
 * Commands that write the page files into the sandbox, a slice of their base64
 * at a time so none reaches the exec argument limit. Slices land in a `.part`
 * directory that only the last command renames, so an interrupted upload never
 * looks complete. Base64 has no quote, so each slice is safe in single quotes.
 */
export const buildStageCommands = (
  files: PageFiles,
  pageDir = PAGE_DIR,
  commandLimit = STAGE_COMMAND_LIMIT,
) => {
  const key = pageStageKey(files);
  const part = `"$__P/.stage/${key}.part"`;
  const head = `__P=${pageDir}; mkdir -p ${part}`;
  const budget = commandLimit - head.length - 512;

  const writes: string[] = [];
  for (const [file, text] of Object.entries(pageFileTexts(files))) {
    const encoded = toBase64(text);
    const target = `"$__P/.stage/${key}.part/${stagedName(file)}"`;
    // Leaves room for the truncate that opens each file, so the first slice joins it.
    const sliceSize = budget - 2 * target.length - 64;
    writes.push(`: > ${target}`);
    for (let start = 0; start < encoded.length; start += sliceSize) {
      writes.push(`printf '%s' '${encoded.slice(start, start + sliceSize)}' >> ${target}`);
    }
  }
  writes.push(`rm -rf "$__P/.stage/${key}" && mv ${part} "$__P/.stage/${key}"`);

  const commands: string[] = [];
  let batch: string[] = [];
  let size = 0;
  for (const write of writes) {
    if (batch.length > 0 && size + write.length + 4 > budget) {
      commands.push([head, ...batch].join(' && '));
      batch = [];
      size = 0;
    }
    batch.push(write);
    size += write.length + 4;
  }
  commands.push([head, ...batch].join(' && '));
  return commands;
};

const stagedPageScript = (key: string, notStagedMarker: string) => {
  const dir = `$__P/.stage/${key}`;
  return [
    `if [ ! -f "${dir}/${stagedName('.meta/outline')}" ]; then printf '\\n%s\\n' "${notStagedMarker}"; exit 0; fi`,
    ...pageFileNames.map((file) => `base64 -d < "${dir}/${stagedName(file)}" > "$__P/${file}"`),
    `find "$__P/.stage" -mindepth 1 -maxdepth 1 ! -name '${key}' -exec rm -rf {} +`,
  ];
};

/**
 * Wraps the command so it starts on the current page under `pageDir` and
 * reports what it changed. With `stageKey`, the page files come from a copy
 * {@link buildStageCommands} wrote; when that copy is missing the wrapper
 * prints the not-staged marker and exits before running the command. It exits
 * 0 because a provider may turn any other status into a failed tool call, and
 * the marker alone tells the caller to stage.
 */
export const wrapPageCommand = (
  command: string,
  files: PageFiles,
  nonce: string,
  pageDir = PAGE_DIR,
  { stageKey }: { stageKey?: string } = {},
) => {
  const tag = `__LOBE_PAGE_${nonce}`;
  const marker = `__LOBE_SYNC_${nonce}`;
  const texts = pageFileTexts(files);
  return [
    `__P=${pageDir}; mkdir -p "$__P/.orig" "$__P/.meta"`,
    ...(stageKey
      ? stagedPageScript(stageKey, `${marker}_NOT_STAGED`)
      : pageFileNames.map((file) => heredoc(`$__P/${file}`, texts[file], tag))),
    'cp "$__P/doc.xml" "$__P/title" "$__P/.orig/"',
    `(\n${command}\n)`,
    '__lobe_rc=$?',
    `for __f in ${SYNCED_FILES.join(' ')}; do`,
    `  if [ ! -f "$__P/$__f" ]; then printf '\\n%s\\n' "${marker}_DELETED_$__f";`,
    `  elif [ "$(cksum < "$__P/$__f")" != "$(cksum < "$__P/.orig/$__f")" ]; then`,
    `    printf '\\n%s\\n' "${marker}_BEGIN_$__f"; base64 < "$__P/$__f"; printf '%s\\n' "${marker}_END_$__f";`,
    '  fi',
    'done',
    'exit $__lobe_rc',
  ].join('\n');
};

const outputOf = (result: SandboxCallToolResult) => {
  const raw = (result.result ?? {}) as Record<string, unknown>;
  return String(raw.stdout ?? raw.output ?? '');
};

/**
 * Runs the command on the page. A small page rides inline in the command; a
 * large one is staged once per version and reused by later commands.
 */
const runOnPage = async (
  service: ISandboxService,
  toolName: string,
  params: Record<string, unknown> & { command: string },
  files: PageFiles,
  nonce: string,
  pageDir = PAGE_DIR,
): Promise<SandboxCallToolResult> => {
  const inline = wrapPageCommand(params.command, files, nonce, pageDir);
  if (Buffer.byteLength(inline) - Buffer.byteLength(params.command) <= INLINE_PAGE_LIMIT) {
    return service.callTool(toolName, { ...params, command: inline });
  }

  const stageKey = pageStageKey(files);
  const command = wrapPageCommand(params.command, files, nonce, pageDir, { stageKey });
  const notStaged = `\n__LOBE_SYNC_${nonce}_NOT_STAGED\n`;

  const first = await service.callTool(toolName, { ...params, command });
  if (!first.success || !outputOf(first).includes(notStaged)) return first;

  for (const stage of buildStageCommands(files, pageDir)) {
    const staged = await service.callTool('runCommand', { command: stage });
    const raw = (staged.result ?? {}) as { exitCode?: unknown; success?: unknown };
    if (!staged.success) return staged;
    if ((typeof raw.exitCode === 'number' && raw.exitCode !== 0) || raw.success === false) {
      return {
        ...staged,
        error: { message: `The page could not be written to ${PAGE_DIR} in the sandbox.` },
        success: false,
      };
    }
  }

  const result = await service.callTool(toolName, { ...params, command });
  if (result.success && outputOf(result).includes(notStaged)) {
    return {
      ...result,
      error: {
        message: `The page could not be written to ${PAGE_DIR} in the sandbox; run the command again.`,
      },
      success: false,
    };
  }
  return result;
};

export interface ParsedPageOutput {
  changed: Partial<Record<SyncedFile, string>>;
  deleted: SyncedFile[];
  output: string;
}

export const parsePageOutput = (output: string, nonce: string): ParsedPageOutput => {
  const marker = `__LOBE_SYNC_${nonce}`;
  const changed: ParsedPageOutput['changed'] = {};
  const deleted: SyncedFile[] = [];
  let rest = output;

  for (const file of SYNCED_FILES) {
    const begin = `\n${marker}_BEGIN_${file}\n`;
    const end = `${marker}_END_${file}\n`;
    const start = rest.indexOf(begin);
    if (start !== -1) {
      const stop = rest.indexOf(end, start + begin.length);
      if (stop !== -1) {
        changed[file] = fromBase64(rest.slice(start + begin.length, stop));
        rest = rest.slice(0, start) + rest.slice(stop + end.length);
      }
    }
    const gone = `\n${marker}_DELETED_${file}\n`;
    if (rest.includes(gone)) {
      deleted.push(file);
      rest = rest.replace(gone, '');
    }
  }

  return { changed, deleted, output: rest };
};

const swapIds = (xml: string, map: Map<string, string>) =>
  xml.replaceAll(/\bid="([^"]+)"/g, (whole, id: string) => {
    const next = map.get(id);
    return next ? `id="${next}"` : whole;
  });

const invert = (map: Map<string, string>) => new Map([...map].map(([key, value]) => [value, key]));

interface ApplyResult {
  changed: boolean;
  messages: string[];
}

/** The page as a command saw it: its LiteXML in stable ids, title and stored version. */
interface PageSnapshot {
  stableXml: string;
  title: string;
  version?: string;
}

// Lexical numbers nodes from one process-wide counter, which a stored-id
// hydration anywhere resets. No editor may live across the sandbox command,
// so each phase opens its own under the headless-editor lock.
const readPage = (sessions: PageSessions, documentId: string): Promise<PageSnapshot> =>
  withHeadlessEditorLock(async () => {
    const session = await sessions.openSession(documentId);
    try {
      const keyXml = session.draft.editor.export({ litexml: true }).litexml ?? '';
      return {
        stableXml: swapIds(keyXml, session.draft.stableIds()),
        title: session.title,
        version: session.version,
      };
    } finally {
      session.draft.destroy();
    }
  });

// Block operations in stable ids, addressed to the keys of a later session.
const toSessionIds = (
  operation: ModifyOperation,
  stableToKey: Map<string, string>,
): ModifyOperation => {
  const key = (id: string) => stableToKey.get(id) ?? id;
  switch (operation.action) {
    case 'insert': {
      return 'afterId' in operation
        ? { ...operation, afterId: key(operation.afterId) }
        : { ...operation, beforeId: key(operation.beforeId) };
    }
    case 'remove': {
      return { ...operation, id: key(operation.id) };
    }
    case 'modify': {
      const litexml = Array.isArray(operation.litexml)
        ? operation.litexml.map((xml) => swapIds(xml, stableToKey))
        : swapIds(operation.litexml, stableToKey);
      return { ...operation, litexml };
    }
  }
};

const changedMessage = (error: PageChangedError) =>
  error.reason === 'locked'
    ? 'Nothing was written: another member is editing the page. Try again later.'
    : `Nothing was written: the page changed after this command read it. Read ${PAGE_DIR}/doc.xml again and redo the edit.`;

/**
 * Applies what the command changed to the page as it is now. The block diff is
 * taken against the page the command read, so edits others made meanwhile to
 * other blocks survive in a room; a stored page that changed refuses instead.
 */
const writePage = async (
  sessions: PageSessions,
  documentId: string,
  base: PageSnapshot,
  parsed: ParsedPageOutput,
): Promise<ApplyResult> => {
  const messages: string[] = parsed.deleted.map(
    (file) => `warning: ${PAGE_DIR}/${file} was deleted; ignored.`,
  );

  let operations: ModifyOperation[] = [];
  let summary: LiteXMLBlockDiffSummary | undefined;
  const nextStableXml = parsed.changed['doc.xml'];
  if (nextStableXml !== undefined) {
    if (nextStableXml.length > Math.max(4 * base.stableXml.length, MIN_SIZE_LIMIT)) {
      messages.push(
        'Nothing was written: the edited page is too large compared with the current one.',
      );
      return { changed: false, messages };
    }
    const diff = diffLiteXMLBlocks(base.stableXml, nextStableXml);
    if (!diff.ok) {
      messages.push(`Nothing was written: ${PAGE_DIR}/doc.xml ${diff.reason}.`);
      return { changed: false, messages };
    }
    if (diff.operations.length === 0) {
      messages.push(`${PAGE_DIR}/doc.xml: no block changes detected.`);
    }
    operations = diff.operations;
    summary = diff.summary;
  }

  let nextTitle = parsed.changed.title?.replace(/\r?\n$/, '');
  if (nextTitle !== undefined && nextTitle !== base.title) {
    if (!nextTitle.trim() || /[\n\r]/.test(nextTitle)) {
      messages.push(
        `Nothing was written to the title: ${PAGE_DIR}/title must hold a single non-empty line.`,
      );
      nextTitle = undefined;
    } else {
      nextTitle = nextTitle.trim();
    }
  } else {
    nextTitle = undefined;
  }

  if (operations.length === 0 && nextTitle === undefined) return { changed: false, messages };

  return withHeadlessEditorLock(async () => {
    let session: PageSession;
    try {
      session = await sessions.openSession(documentId, { expectedVersion: base.version });
    } catch (error) {
      if (!(error instanceof PageChangedError)) throw error;
      messages.push(changedMessage(error));
      return { changed: false, messages };
    }

    try {
      if (operations.length > 0 && summary) {
        const runtime = new EditorRuntime();
        runtime.setEditor(session.draft.editor.kernel as any);
        runtime.setCurrentDocId(documentId);
        runtime.setTitleHandlers(
          () => {},
          () => session.title,
        );
        const stableToKey = invert(session.draft.stableIds());
        const result = await runtime.modifyNodes({
          operations: operations.map((operation) => toSessionIds(operation, stableToKey)),
        });
        const { inserted, modified, removed } = summary;
        messages.push(
          `${PAGE_DIR}/doc.xml: ${modified} modified, ${inserted} inserted, ${removed} removed; changes await the user's review.`,
          formatModifyNodesResult(result),
        );
      }
      if (nextTitle !== undefined) {
        session.setTitle(nextTitle);
        messages.push(`${PAGE_DIR}/title: renamed to "${nextTitle}".`);
      }

      let changed: boolean;
      try {
        changed = await session.commit();
      } catch (error) {
        if (!(error instanceof PageChangedError)) throw error;
        messages.push(changedMessage(error));
        return { changed: false, messages };
      }

      if (changed && operations.length > 0) {
        const refreshed = swapIds(
          session.draft.editor.export({ litexml: true }).litexml ?? '',
          session.draft.stableIds(),
        );
        messages.push(
          `${PAGE_DIR}/.meta/outline (ids after this edit):\n${buildOutline(refreshed)}`,
        );
      }
      return { changed, messages };
    } finally {
      session.draft.destroy();
    }
  });
};

const withOutput = (result: SandboxCallToolResult, transform: (text: string) => string) => {
  if (!result.success || !result.result || typeof result.result !== 'object') return result;
  const raw = result.result as Record<string, unknown>;
  const key = typeof raw.stdout === 'string' ? 'stdout' : 'output';
  return { ...result, result: { ...raw, [key]: transform(String(raw[key] ?? '')) } };
};

export const withPageSync = (
  service: ISandboxService,
  options: {
    documentId: string;
    nonce?: () => string;
    pageDir?: string;
    sessions: PageSessions;
  },
): ISandboxService => ({
  callTool: async (toolName, params) => {
    if (!SYNCED_TOOLS.has(toolName) || typeof params?.command !== 'string') {
      return service.callTool(toolName, params);
    }
    if (params.background) {
      const result = await service.callTool(toolName, params);
      return withOutput(
        result,
        (text) => `${text}\nnote: background commands do not sync edits to ${PAGE_DIR}.`,
      );
    }

    const { documentId, sessions } = options;
    return runPageExclusive(documentId, async () => {
      let base: PageSnapshot;
      try {
        base = await readPage(sessions, documentId);
      } catch (error) {
        if (!(error instanceof PageUnsupportedError)) throw error;
        const result = await service.callTool(toolName, params);
        return withOutput(result, (text) => `${text}\nnote: ${error.message}`);
      }

      const nonce = options.nonce?.() ?? crypto.randomUUID().replaceAll('-', '');
      const result = await runOnPage(
        service,
        toolName,
        { ...params, command: params.command },
        { outline: buildOutline(base.stableXml), title: base.title, xml: base.stableXml },
        nonce,
        options.pageDir,
      );
      if (!result.success) return result;

      const raw = (result.result ?? {}) as Record<string, unknown>;
      const parsed = parsePageOutput(String(raw.stdout ?? raw.output ?? ''), nonce);
      const applied = await writePage(sessions, documentId, base, parsed);
      const notes = result.sessionExpiredAndRecreated
        ? [
            `note: the sandbox was recreated; files outside ${PAGE_DIR} from earlier calls are gone.`,
          ]
        : [];

      return withOutput(result, () =>
        [parsed.output.trimEnd(), ...applied.messages, ...notes].filter(Boolean).join('\n'),
      );
    });
  },
  exportAndUploadFile: (path, filename, exportOptions) =>
    service.exportAndUploadFile(path, filename, exportOptions),
});
