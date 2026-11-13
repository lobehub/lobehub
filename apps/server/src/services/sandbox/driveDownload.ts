import { randomUUID } from 'node:crypto';

import debug from 'debug';

import type { PreSignedUpload } from '@/server/modules/S3';

import { type SandboxStorageExportResult, SandboxStorageFilesError } from './storageFiles';
import type { SandboxService } from './types';

const log = debug('lobe-server:sandbox:drive-download');

/**
 * Ceiling on what one download packs or carries: the bytes of the files it
 * reads, before compression. Large enough for any folder a person keeps work
 * in, small enough that packing it and uploading it fit in one request rather
 * than outliving it. A checkout with its dependencies installed can pass it;
 * the refusal says so instead of timing out.
 */
export const DRIVE_DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024;

/** The same idea for the number of files: walking a million costs more than reading them. */
export const DRIVE_DOWNLOAD_MAX_FILES = 50_000;

/** How long the sandbox may spend packing and uploading. */
export const DRIVE_DOWNLOAD_TIMEOUT_MS = 180_000;

/**
 * How long the storage service may spend exporting. It answers well inside
 * this or not at all; past it the request is abandoned rather than holding
 * this one open, and not retried in a sandbox, which would stall the same way.
 */
export const DRIVE_EXPORT_TIMEOUT_MS = 90_000;

/** How long the link the browser follows stays valid. */
export const DRIVE_DOWNLOAD_URL_EXPIRES_IN = 15 * 60;

/**
 * How long a preview link stays valid: longer than a download's, since a
 * video or PDF keeps fetching ranges for as long as it stays open. Still well
 * inside the day the sweep keeps every copy for.
 */
export const DRIVE_PREVIEW_URL_EXPIRES_IN = 60 * 60;

/**
 * What the copy is for: `download` saves it — a folder packed as a zip —
 * and `preview` shows one file in the page, so a folder is refused.
 */
export type DriveCopyPurpose = 'download' | 'preview';

/**
 * Where the transient copies go, one folder per UTC day
 * (`sandbox-drive-downloads/2026-11-01/<uuid>`), which is what lets them be
 * swept by date without a record of each one.
 */
export const DRIVE_DOWNLOAD_PREFIX = 'sandbox-drive-downloads/';

/** Marks the one line of the command's output that is its answer. */
const RESULT_MARKER = 'LOBE_DRIVE_DOWNLOAD_RESULT ';

/**
 * Packs (a folder) or takes as it is (a file) one path on the drive and PUTs it
 * to the upload URL, from inside a sandbox session the drive is mounted in.
 *
 * The working directory is the drive's root, which is what every relative
 * path here is resolved against. Other members and sandboxes may be changing
 * the drive while this runs, so nothing is checked by name and then read by
 * name: the target is opened one component at a time beneath the root with
 * `O_NOFOLLOW`, a folder is walked with `os.fwalk` (directory descriptors, no
 * links followed), and each file is read through the descriptor it was opened
 * as. A link anywhere is never followed — the target that is or passes through
 * one is refused, and one inside a folder is left out. The hidden directories
 * the caller names are skipped as if they were not there.
 *
 * Anything that cannot be read fails the download rather than leaving a hole
 * in an archive that claims to be complete. The archive is built in `/tmp`,
 * never on the drive, so it costs the drive no quota.
 *
 * It prints exactly one {@link RESULT_MARKER} line, success or not, and always
 * exits 0: a non-zero exit would read as "the command could not run" and lose
 * the reason.
 */
const SCRIPT = String.raw`
import base64, errno, json, mimetypes, os, posixpath, stat, sys, tempfile, time, urllib.error, urllib.request, zipfile

MARKER = ${JSON.stringify(RESULT_MARKER)}
NOFOLLOW = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
NOT_THERE = (errno.ENOENT, errno.ENOTDIR, errno.ELOOP)

def done(**result):
    sys.stdout.write(MARKER + json.dumps(result) + "\n")
    sys.stdout.flush()
    sys.exit(0)

params = json.loads(base64.b64decode(os.environ["LOBE_DRIVE_DOWNLOAD"]).decode("utf-8"))
max_bytes = int(params["maxBytes"])
max_files = int(params["maxFiles"])

def within(path, parent):
    return path == parent or path.startswith(parent + "/")

hidden = [posixpath.normpath(entry) for entry in params.get("hidden", [])]

def is_hidden(rel):
    return any(within(rel, entry) for entry in hidden)

target = posixpath.normpath(params["path"])
if target in ("", ".") or target.startswith("/") or target == ".." or target.startswith("../") or is_hidden(target):
    done(ok=False, code="NOT_FOUND")

root_fd = os.open(".", os.O_RDONLY | os.O_DIRECTORY)

def open_beneath(rel):
    """Opens a path under the root without following a link at any component."""
    parts = rel.split("/")
    fd = os.dup(root_fd)
    try:
        for part in parts[:-1]:
            child = os.open(part, NOFOLLOW | os.O_DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = child
        return os.open(parts[-1], NOFOLLOW, dir_fd=fd)
    finally:
        os.close(fd)

try:
    target_fd = open_beneath(target)
except OSError as error:
    done(ok=False, code="NOT_FOUND" if error.errno in NOT_THERE else "READ_FAILED")

def read_failed(rel, error):
    done(ok=False, code="READ_FAILED", path=rel, message=str(error)[:200])

def raise_error(error):
    raise error

def walk():
    """The folder's directories, each with its regular files' (name, stat), hidden ones left out."""
    for current, dirnames, filenames, dir_fd in os.fwalk(".", dir_fd=target_fd, follow_symlinks=False, onerror=raise_error):
        sub = posixpath.normpath(current)
        rel = target if sub == "." else posixpath.join(target, sub)
        dirnames[:] = sorted(name for name in dirnames if not is_hidden(posixpath.join(rel, name)))
        files = []
        for name in sorted(filenames):
            try:
                info = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
            except OSError as error:
                read_failed(posixpath.join(rel, name), error)
            # Links and special files are not content of the folder.
            if stat.S_ISREG(info.st_mode):
                files.append((name, info))
        yield rel, dirnames, files, dir_fd

def zip_info(name, info):
    entry = zipfile.ZipInfo(name, date_time=time.localtime(max(info.st_mtime, 315532800))[:6])
    entry.external_attr = (info.st_mode & 0xFFFF) << 16
    return entry

upload_fd = None
cleanup = None

try:
    info = os.fstat(target_fd)
    if stat.S_ISDIR(info.st_mode):
        if params.get("fileOnly"):
            done(ok=False, code="NOT_A_FILE")
        total = 0
        count = 0
        try:
            for _, _, files, _ in walk():
                # Every directory is an entry walked, and maybe one archived.
                count += len(files) + 1
                total += sum(entry.st_size for _, entry in files)
                if total > max_bytes or count > max_files:
                    done(ok=False, code="TOO_LARGE", bytes=total, files=count)
        except OSError as error:
            read_failed(target, error)

        base = posixpath.dirname(target)
        handle, cleanup = tempfile.mkstemp(dir="/tmp" if os.path.isdir("/tmp") else None, suffix=".zip")
        os.close(handle)
        # The drive can change between the two walks, so the ceilings hold
        # again here, on what is actually read rather than on what was listed.
        packed_bytes = 0
        packed_entries = 0

        def over_limit():
            if packed_bytes > max_bytes or packed_entries > max_files:
                done(ok=False, code="TOO_LARGE", bytes=packed_bytes, files=packed_entries)

        with zipfile.ZipFile(cleanup, "w", zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=1) as archive:
            try:
                for rel, dirnames, files, dir_fd in walk():
                    packed_entries += 1
                    over_limit()
                    name = posixpath.relpath(rel, base) if base else rel
                    if not files and not dirnames:
                        archive.writestr(zip_info(name + "/", os.fstat(dir_fd)), b"")
                    for file_name, _ in files:
                        path = posixpath.join(rel, file_name)
                        try:
                            fd = os.open(file_name, NOFOLLOW, dir_fd=dir_fd)
                        except OSError as error:
                            # Became a link since it was listed: still not followed.
                            if error.errno == errno.ELOOP:
                                continue
                            read_failed(path, error)
                        with os.fdopen(fd, "rb") as source:
                            current = os.fstat(source.fileno())
                            if not stat.S_ISREG(current.st_mode):
                                continue
                            packed_entries += 1
                            over_limit()
                            entry = zip_info(posixpath.join(name, file_name), current)
                            entry.compress_type = zipfile.ZIP_DEFLATED
                            with archive.open(entry, "w", force_zip64=True) as sink:
                                while True:
                                    chunk = source.read(1024 * 1024)
                                    if not chunk:
                                        break
                                    packed_bytes += len(chunk)
                                    over_limit()
                                    sink.write(chunk)
            except OSError as error:
                read_failed(target, error)
        upload_fd = os.open(cleanup, os.O_RDONLY)
        content_type = "application/zip"
        kind = "directory"
    elif stat.S_ISREG(info.st_mode):
        if info.st_size > max_bytes:
            done(ok=False, code="TOO_LARGE", bytes=info.st_size, files=1)
        upload_fd = target_fd
        content_type = mimetypes.guess_type(target)[0] or "application/octet-stream"
        kind = "file"
    else:
        done(ok=False, code="NOT_FOUND")

    # Measured again right before sending: a file can grow after it was checked.
    size = os.fstat(upload_fd).st_size
    if size > max_bytes:
        done(ok=False, code="TOO_LARGE", bytes=size, files=1)

    class Capped:
        """The first size bytes and no more, whatever is appended meanwhile."""

        def __init__(self, source):
            self.source = source
            self.remaining = size

        def read(self, amount=-1):
            if self.remaining <= 0:
                return b""
            amount = self.remaining if amount is None or amount < 0 else min(amount, self.remaining)
            chunk = self.source.read(amount)
            self.remaining -= len(chunk)
            return chunk

    headers = dict(params.get("headers") or {})
    headers["Content-Length"] = str(size)
    headers["Content-Type"] = content_type
    with os.fdopen(upload_fd, "rb") as source:
        upload_fd = None
        body = Capped(source)
        request = urllib.request.Request(params["uploadUrl"], data=body, headers=headers, method="PUT")
        try:
            with urllib.request.urlopen(request, timeout=170) as response:
                response.read()
        except urllib.error.HTTPError as error:
            done(ok=False, code="UPLOAD_FAILED", status=error.code)
        except Exception as error:
            done(ok=False, code="UPLOAD_FAILED", message=str(error)[:200])
    done(ok=True, kind=kind, size=size, contentType=content_type)
finally:
    if cleanup:
        try:
            os.remove(cleanup)
        except OSError:
            pass
`;

export interface DriveDownloadCommandParams {
  /** Refuse a folder instead of packing it — a preview shows one file. */
  fileOnly?: boolean;
  /** Paths, relative to the drive's root, that must not end up in the download. */
  hidden: string[];
  maxBytes: number;
  maxFiles: number;
  /** Relative to the drive's root. */
  path: string;
  uploadHeaders?: Record<string, string>;
  uploadUrl: string;
}

/**
 * The shell command that runs {@link SCRIPT}. Its input travels as base64 in
 * an environment variable and the script as a quoted heredoc, so nothing a
 * path or a URL contains is ever parsed by the shell.
 */
export const buildDriveDownloadCommand = ({
  fileOnly,
  hidden,
  maxBytes,
  maxFiles,
  path,
  uploadHeaders,
  uploadUrl,
}: DriveDownloadCommandParams) => {
  const payload = Buffer.from(
    JSON.stringify({
      fileOnly: fileOnly || undefined,
      headers: uploadHeaders,
      hidden,
      maxBytes,
      maxFiles,
      path,
      uploadUrl,
    }),
    'utf8',
  ).toString('base64');

  return `LOBE_DRIVE_DOWNLOAD='${payload}' python3 - <<'LOBE_DRIVE_DOWNLOAD_PY'\n${SCRIPT}\nLOBE_DRIVE_DOWNLOAD_PY`;
};

export type DriveDownloadOutcome =
  | { contentType: string; kind: 'directory' | 'file'; ok: true; size: number }
  | {
      bytes?: number;
      code: 'NOT_A_FILE' | 'NOT_FOUND' | 'READ_FAILED' | 'TOO_LARGE' | 'UPLOAD_FAILED';
      ok: false;
    };

/** The script's answer, or `undefined` when it never printed one (it did not run, or died). */
export const parseDriveDownloadOutput = (stdout: string): DriveDownloadOutcome | undefined => {
  const line = stdout
    .split('\n')
    .reverse()
    .find((entry) => entry.startsWith(RESULT_MARKER));
  if (!line) return;

  try {
    return JSON.parse(line.slice(RESULT_MARKER.length)) as DriveDownloadOutcome;
  } catch {
    return;
  }
};

/** Why a download could not be prepared, as the code the client translates. */
export class DriveDownloadError extends Error {
  readonly code:
    | 'DOWNLOAD_FAILED'
    | 'DOWNLOAD_TOO_LARGE'
    | 'DOWNLOAD_UNAVAILABLE'
    | 'PATH_NOT_FOUND'
    | 'PREVIEW_NOT_A_FILE';

  constructor(code: DriveDownloadError['code'], detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'DriveDownloadError';
    this.code = code;
  }
}

/** The name the browser saves it under: the file's own, or the folder's with `.zip`. */
export const driveDownloadFileName = (path: string, kind: 'directory' | 'file') => {
  const name = path.split('/').findLast(Boolean) || 'download';
  return kind === 'directory' ? `${name}.zip` : name;
};

export interface PrepareDriveDownloadParams {
  fileService: {
    createDownloadUrl: (url: string, fileName: string, expiresIn?: number) => Promise<string>;
    createPreSignedUrlForPreview: (key: string, expiresIn?: number) => Promise<string>;
    createPreSignedUpload: (
      key: string,
      options?: { private?: boolean },
    ) => Promise<PreSignedUpload>;
    deleteFile: (key: string) => Promise<unknown>;
    deleteFiles: (keys: string[]) => Promise<unknown>;
    listFileKeys: (prefix: string, limit?: number) => Promise<string[]>;
  };
  hidden: string[];
  now?: Date;
  path: string;
  /** Defaults to `download`. */
  purpose?: DriveCopyPurpose;
  /** Packs the copy in a session, where the storage service cannot export it. */
  sandbox: Pick<SandboxService, 'callTool' | 'capabilities'>;
  /**
   * The drive's storage service, which copies off the volume without a
   * sandbox session — tried first. Absent where there is none.
   */
  storage?: {
    exportFile: (
      params: {
        fileOnly?: boolean;
        hidden?: string[];
        maxBytes?: number;
        maxFiles?: number;
        path: string;
        uploadHeaders?: Record<string, string>;
        uploadUrl: string;
      },
      options?: { signal?: AbortSignal },
    ) => Promise<SandboxStorageExportResult>;
  };
}

type CopyOutcome = Extract<DriveDownloadOutcome, { ok: true }>;

/** The export refusals that mean something to the person, as the codes the client translates. */
const EXPORT_REFUSALS: Record<string, DriveDownloadError['code']> = {
  EXPORT_NOT_A_FILE: 'PREVIEW_NOT_A_FILE',
  EXPORT_NOT_FOUND: 'PATH_NOT_FOUND',
  EXPORT_TOO_LARGE: 'DOWNLOAD_TOO_LARGE',
};

/**
 * Copies through the storage service, or answers `undefined` when this
 * deployment's cannot: one without the file function says so (501), and one
 * that predates the route does not know it (a 404 with no code of ours).
 */
const exportFromStorage = async (
  storage: NonNullable<PrepareDriveDownloadParams['storage']>,
  params: { fileOnly: boolean; hidden: string[]; path: string; upload: PreSignedUpload },
): Promise<CopyOutcome | undefined> => {
  try {
    const result = await storage.exportFile(
      {
        fileOnly: params.fileOnly || undefined,
        hidden: params.hidden,
        maxBytes: DRIVE_DOWNLOAD_MAX_BYTES,
        maxFiles: DRIVE_DOWNLOAD_MAX_FILES,
        path: params.path,
        uploadHeaders: params.upload.headers,
        uploadUrl: params.upload.url,
      },
      { signal: AbortSignal.timeout(DRIVE_EXPORT_TIMEOUT_MS) },
    );
    return { ...result, ok: true };
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === 'TimeoutError') {
      log('drive export timed out after %dms', DRIVE_EXPORT_TIMEOUT_MS);
      throw new DriveDownloadError('DOWNLOAD_FAILED', 'EXPORT_TIMEOUT');
    }
    if (error instanceof SandboxStorageFilesError) {
      const unsupported =
        error.code === 'EXPORT_UNAVAILABLE' ||
        ((error.status === 404 || error.status === 405) && !error.code?.startsWith('EXPORT_'));
      if (unsupported) {
        log('storage cannot export (%d %s), packing in a sandbox', error.status, error.code);
        return;
      }
      const refusal = error.code && EXPORT_REFUSALS[error.code];
      if (refusal) throw new DriveDownloadError(refusal);
      log('drive export failed: %O', error);
      throw new DriveDownloadError('DOWNLOAD_FAILED', error.code || error.message);
    }
    throw error;
  }
};

/** Packs the copy inside a sandbox session the drive is mounted in. */
const copyInSandbox = async (
  sandbox: PrepareDriveDownloadParams['sandbox'],
  params: { fileOnly: boolean; hidden: string[]; path: string; upload: PreSignedUpload },
): Promise<CopyOutcome> => {
  const result = await sandbox.callTool('runCommand', {
    command: buildDriveDownloadCommand({
      fileOnly: params.fileOnly,
      hidden: params.hidden,
      maxBytes: DRIVE_DOWNLOAD_MAX_BYTES,
      maxFiles: DRIVE_DOWNLOAD_MAX_FILES,
      path: params.path,
      uploadHeaders: params.upload.headers,
      uploadUrl: params.upload.url,
    }),
    timeout: DRIVE_DOWNLOAD_TIMEOUT_MS,
  });

  const stdout = (result.result as { stdout?: unknown } | null | undefined)?.stdout;
  const outcome = typeof stdout === 'string' ? parseDriveDownloadOutput(stdout) : undefined;

  if (!outcome) {
    log('drive download produced no result: %O', result.error ?? result.result);
    throw new DriveDownloadError('DOWNLOAD_FAILED', result.error?.message);
  }

  if (!outcome.ok) {
    log('drive download refused: %O', outcome);
    if (outcome.code === 'NOT_FOUND') throw new DriveDownloadError('PATH_NOT_FOUND');
    if (outcome.code === 'TOO_LARGE') throw new DriveDownloadError('DOWNLOAD_TOO_LARGE');
    if (outcome.code === 'NOT_A_FILE') throw new DriveDownloadError('PREVIEW_NOT_A_FILE');
    throw new DriveDownloadError('DOWNLOAD_FAILED', outcome.code);
  }

  return outcome;
};

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The copies from before yesterday (UTC). Their links lasted
 * {@link DRIVE_DOWNLOAD_URL_EXPIRES_IN}, so nobody can still be fetching them;
 * keeping yesterday's too means a link handed out just before midnight is
 * never pulled out from under its download.
 */
export const expiredDriveDownloadKeys = (keys: string[], now: Date) => {
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const cutoff = dayOf(yesterday);

  return keys.filter((key) => {
    const day = key.slice(DRIVE_DOWNLOAD_PREFIX.length, DRIVE_DOWNLOAD_PREFIX.length + 10);
    return key.startsWith(DRIVE_DOWNLOAD_PREFIX) && /^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoff;
  });
};

/**
 * Deletes expired copies, a page at a time. Keys sort by day, so the oldest
 * come first and every download clears up to a page of what earlier ones
 * left. Best-effort: a bucket that refuses listing or deleting must not cost
 * the person their download. A storage lifecycle rule on the prefix does the
 * same job more cheaply where one is configured; this keeps a deployment
 * without one from growing without bound.
 */
const sweepExpiredDownloads = async (
  fileService: PrepareDriveDownloadParams['fileService'],
  now: Date,
) => {
  try {
    const expired = expiredDriveDownloadKeys(
      await fileService.listFileKeys(DRIVE_DOWNLOAD_PREFIX),
      now,
    );
    if (expired.length > 0) await fileService.deleteFiles(expired);
  } catch (error) {
    log('sweeping expired drive downloads failed: %O', error);
  }
};

/**
 * Puts one file or folder of the drive where the browser can fetch it, and
 * answers with the link.
 *
 * The bytes never pass through this server: the drive's storage service
 * reads them off the volume and uploads them straight to object storage. Only
 * where it cannot (a deployment without that service) are they packed inside
 * a sandbox session the drive is mounted in — which a shared storage, a
 * workspace's public drive, refuses at its root. The object is a transient copy, not a library file: no file record
 * is made, so a download never shows up among the user's resources. A copy
 * that never gets a link is deleted at once; the rest are swept once expired.
 */
export const prepareDriveDownload = async ({
  fileService,
  hidden,
  now = new Date(),
  path,
  purpose = 'download',
  sandbox,
  storage,
}: PrepareDriveDownloadParams) => {
  if (!storage && !sandbox.capabilities.shell) {
    throw new DriveDownloadError('DOWNLOAD_UNAVAILABLE');
  }

  const key = `${DRIVE_DOWNLOAD_PREFIX}${dayOf(now)}/${randomUUID()}`;
  // Private whatever the bucket's default ACL: a copy of someone's drive is
  // reachable only through the short-lived link below.
  const upload = await fileService.createPreSignedUpload(key, { private: true });
  // Alongside the packing, which takes far longer.
  const sweep = sweepExpiredDownloads(fileService, now);

  try {
    const copy = { fileOnly: purpose === 'preview', hidden, path, upload };
    let outcome = storage ? await exportFromStorage(storage, copy) : undefined;
    if (!outcome) {
      if (!sandbox.capabilities.shell) throw new DriveDownloadError('DOWNLOAD_UNAVAILABLE');
      outcome = await copyInSandbox(sandbox, copy);
    }

    const fileName = driveDownloadFileName(path, outcome.kind);
    // A preview is shown in the page, so its link answers inline; a download's
    // answers as an attachment the browser saves.
    const url =
      purpose === 'preview'
        ? await fileService.createPreSignedUrlForPreview(key, DRIVE_PREVIEW_URL_EXPIRES_IN)
        : await fileService.createDownloadUrl(key, fileName, DRIVE_DOWNLOAD_URL_EXPIRES_IN);

    return {
      contentType: outcome.contentType,
      fileName,
      kind: outcome.kind,
      size: outcome.size,
      url,
    };
  } catch (error) {
    // Whatever was uploaded before the failure is unreachable without a link.
    await fileService.deleteFile(key).catch((cause: unknown) => {
      log('deleting an unused drive download failed: %O', cause);
    });
    throw error;
  } finally {
    await sweep;
  }
};
