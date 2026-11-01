import { defineReplica } from '@/libs/replica';
import type { LocalFilePreview } from '@/services/projectFile';

/** One file the local-file portal previews: where it lives and how it was opened. */
export interface LocalFilePreviewTarget {
  /** A user-picked file outside the approved workspace roots. */
  allowExternalFile?: boolean;
  /** Remote device the file lives on; absent = this machine. */
  deviceId?: string;
  filePath: string;
  /** Read live from this topic's cloud sandbox instead of a filesystem. */
  sandboxTopicId?: string;
  workingDirectory: string;
}

/**
 * Largest text preview (UTF-16 code units) kept across reloads. A huge log or
 * generated file stays memory-only and simply refetches.
 */
export const MAX_PERSISTED_PREVIEW_CHARS = 256 * 1024;

/** How many file previews survive a reload (`persist.maxEntries`). */
export const MAX_PERSISTED_PREVIEWS = 30;

/**
 * Entry key of one preview: source (sandbox / device / this machine) +
 * working directory + path, plus the external-file flag that changes what the
 * read is allowed to reach. A string, so two mounts of the same tab share one
 * entry and one sync query.
 *
 * The source kind and its id are separate fields: a device id is user-chosen
 * (`lh connect --device-id`), so a device named `local` or `sandbox:x` must
 * still decode as that device rather than this machine or a sandbox.
 */
export const localFilePreviewKey = ({
  allowExternalFile,
  deviceId,
  filePath,
  sandboxTopicId,
  workingDirectory,
}: LocalFilePreviewTarget): string =>
  JSON.stringify([
    ...(sandboxTopicId
      ? ['sandbox', sandboxTopicId]
      : deviceId
        ? ['device', deviceId]
        : ['local', null]),
    workingDirectory,
    filePath,
    allowExternalFile ? 'external' : 'workspace',
  ]);

/** The target a {@link localFilePreviewKey} was built from (fetcher side). */
export const localFilePreviewTargetFromKey = (key: string): LocalFilePreviewTarget => {
  const [kind, id, workingDirectory, filePath, access] = JSON.parse(key) as [
    'device' | 'local' | 'sandbox',
    string | null,
    string,
    string,
    string,
  ];
  return {
    allowExternalFile: access === 'external' || undefined,
    deviceId: kind === 'device' ? (id ?? undefined) : undefined,
    filePath,
    sandboxTopicId: kind === 'sandbox' ? (id ?? undefined) : undefined,
    workingDirectory,
  };
};

/**
 * What of a preview survives a reload: text previews only, up to
 * {@link MAX_PERSISTED_PREVIEW_CHARS}. Images / documents hold Blobs and video /
 * binary placeholders are cheap to recompute, so they stay memory-only.
 * `resourceBaseUrl` embeds a short-lived desktop preview token, so it is never
 * stored; the background refresh brings a fresh one.
 *
 * `null` = do not persist, and drop a row stored earlier (a file that grew past
 * the cap or turned binary must not come back on the next boot).
 */
export const toPersistedLocalFilePreview = (preview: LocalFilePreview): LocalFilePreview | null =>
  preview.type === 'text' && preview.content.length <= MAX_PERSISTED_PREVIEW_CHARS
    ? { content: preview.content, contentType: preview.contentType, type: 'text' }
    : null;

/**
 * Whether a preview may touch storage. A cloud-sandbox file is a live read with
 * no durable copy anywhere — once the sandbox is recycled the file is gone — so
 * its content must not outlive the session in IndexedDB. Sandbox previews stay
 * memory-only (no persist, no hydrate).
 */
export const isPersistableLocalFilePreviewKey = (key: string): boolean =>
  !localFilePreviewTargetFromKey(key).sandboxTopicId;

/**
 * File previews of the local-file portal, one entry per opened file. Previews
 * of files on this machine or a device are persisted to IndexedDB under the
 * user / workspace scope, so a reload paints the last text the portal showed
 * while the device confirms it. At most {@link MAX_PERSISTED_PREVIEWS} rows are
 * kept per scope (least recently used evicted), and rows hydrate per opened
 * file, not at startup.
 */
export const localFilePreviewResource = defineReplica<string, LocalFilePreview>({
  key: (key) => key,
  name: 'localFilePreview',
  persist: { maxEntries: MAX_PERSISTED_PREVIEWS },
  persistKey: isPersistableLocalFilePreviewKey,
  storage: 'indexedDB',
  // v2: the key splits the source kind from its id; v1 rows are dropped.
  version: 2,
});
