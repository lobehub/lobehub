import type { ISandboxService, SandboxCallToolResult } from '@lobechat/builtin-tool-cloud-sandbox';
import {
  diffLiteXMLBlocks,
  EditorRuntime,
  formatModifyNodesResult,
  parseLiteXMLBlocks,
} from '@lobechat/editor-runtime';

import type { PageCollabService, PageSession } from './index';

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

const applyPageChanges = async (
  session: PageSession,
  documentId: string,
  snapshot: { keyXml: string; stableToKey: Map<string, string> },
  parsed: ParsedPageOutput,
): Promise<ApplyResult> => {
  const messages: string[] = parsed.deleted.map(
    (file) => `warning: ${PAGE_DIR}/${file} was deleted; ignored.`,
  );

  const nextStableXml = parsed.changed['doc.xml'];
  if (nextStableXml !== undefined) {
    const nextXml = swapIds(nextStableXml, snapshot.stableToKey);
    if (nextXml.length > Math.max(4 * snapshot.keyXml.length, MIN_SIZE_LIMIT)) {
      messages.push(
        'Nothing was written: the edited page is too large compared with the current one.',
      );
      return { changed: false, messages };
    }
    const diff = diffLiteXMLBlocks(snapshot.keyXml, nextXml);
    if (!diff.ok) {
      messages.push(`Nothing was written: ${PAGE_DIR}/doc.xml ${diff.reason}.`);
      return { changed: false, messages };
    }
    if (diff.operations.length === 0) {
      messages.push(`${PAGE_DIR}/doc.xml: no block changes detected.`);
    } else {
      const runtime = new EditorRuntime();
      runtime.setEditor(session.fork.editor.kernel as any);
      runtime.setCurrentDocId(documentId);
      runtime.setTitleHandlers(
        () => {},
        () => session.title,
      );
      const result = await runtime.modifyNodes({ operations: diff.operations });
      const { inserted, modified, removed } = diff.summary;
      messages.push(
        `${PAGE_DIR}/doc.xml: ${modified} modified, ${inserted} inserted, ${removed} removed; changes await the user's review.`,
        formatModifyNodesResult(result),
      );
    }
  }

  const nextTitle = parsed.changed.title?.replace(/\r?\n$/, '');
  if (nextTitle !== undefined && nextTitle !== session.title) {
    if (!nextTitle.trim() || /[\n\r]/.test(nextTitle)) {
      messages.push(
        `Nothing was written to the title: ${PAGE_DIR}/title must hold a single non-empty line.`,
      );
    } else {
      session.setTitle(nextTitle.trim());
      messages.push(`${PAGE_DIR}/title: renamed to "${nextTitle.trim()}".`);
    }
  }

  const changed = await session.commit();

  if (changed && nextStableXml !== undefined) {
    const keyToStable = session.fork.stableIds();
    const refreshed = swapIds(
      session.fork.editor.export({ litexml: true }).litexml ?? '',
      keyToStable,
    );
    messages.push(`${PAGE_DIR}/.meta/outline (ids after this edit):\n${buildOutline(refreshed)}`);
  }

  return { changed, messages };
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
    collab: Pick<PageCollabService, 'openSession'>;
    documentId: string;
    nonce?: () => string;
    pageDir?: string;
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

    const { collab, documentId } = options;
    const session = await collab.openSession(documentId);
    try {
      const keyXml = session.fork.editor.export({ litexml: true }).litexml ?? '';
      const keyToStable = session.fork.stableIds();
      const stableXml = swapIds(keyXml, keyToStable);
      const { title } = session;
      const nonce = options.nonce?.() ?? crypto.randomUUID().replaceAll('-', '');

      const result = await service.callTool(toolName, {
        ...params,
        command: wrapPageCommand(
          params.command,
          { outline: buildOutline(stableXml), title, xml: stableXml },
          nonce,
          options.pageDir,
        ),
      });
      if (!result.success) return result;

      const raw = (result.result ?? {}) as Record<string, unknown>;
      const parsed = parsePageOutput(String(raw.stdout ?? raw.output ?? ''), nonce);
      const applied = await applyPageChanges(
        session,
        documentId,
        { keyXml, stableToKey: invert(keyToStable) },
        parsed,
      );
      const notes = result.sessionExpiredAndRecreated
        ? [
            `note: the sandbox was recreated; files outside ${PAGE_DIR} from earlier calls are gone.`,
          ]
        : [];

      return withOutput(result, () =>
        [parsed.output.trimEnd(), ...applied.messages, ...notes].filter(Boolean).join('\n'),
      );
    } finally {
      session.fork.destroy();
    }
  },
  exportAndUploadFile: (path, filename, exportOptions) =>
    service.exportAndUploadFile(path, filename, exportOptions),
});
