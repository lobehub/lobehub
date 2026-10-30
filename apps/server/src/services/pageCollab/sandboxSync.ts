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

export const buildOutline = (xml: string) => {
  const blocks = parseLiteXMLBlocks(xml);
  if (typeof blocks === 'string' || blocks.length === 0) return '';
  return `${blocks.map(({ id, tag, text }) => `${id ?? '-'} ${tag} ${text.slice(0, 80)}`.trim()).join('\n')}\n`;
};

export const wrapPageCommand = (
  command: string,
  files: { outline: string; title: string; xml: string },
  nonce: string,
  pageDir = PAGE_DIR,
) => {
  const tag = `__LOBE_PAGE_${nonce}`;
  const marker = `__LOBE_SYNC_${nonce}`;
  return [
    `__P=${pageDir}; mkdir -p "$__P/.orig" "$__P/.meta"`,
    heredoc('$__P/doc.xml', files.xml, tag),
    heredoc('$__P/title', `${files.title}\n`, tag),
    heredoc('$__P/.meta/outline', files.outline, tag),
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
      const result = await service.callTool(toolName, {
        ...params,
        command: wrapPageCommand(
          params.command,
          { outline: buildOutline(base.stableXml), title: base.title, xml: base.stableXml },
          nonce,
          options.pageDir,
        ),
      });
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
