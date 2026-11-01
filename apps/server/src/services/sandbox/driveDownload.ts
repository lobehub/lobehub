import { randomUUID } from 'node:crypto';

import debug from 'debug';

import type { PreSignedUpload } from '@/server/modules/S3';

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

/** How long the link the browser follows stays valid. */
export const DRIVE_DOWNLOAD_URL_EXPIRES_IN = 15 * 60;

/** Marks the one line of the command's output that is its answer. */
const RESULT_MARKER = 'LOBE_DRIVE_DOWNLOAD_RESULT ';

/**
 * Packs (a folder) or takes as it is (a file) one path on the drive and PUTs it
 * to the upload URL, from inside a sandbox session the drive is mounted in.
 *
 * The working directory is the drive's root, which is what every relative
 * path here is resolved against. The script never leaves it: the target is
 * resolved through any link and refused when it lands outside, links inside a
 * folder are left out rather than followed, and the hidden directories the
 * caller names are skipped as if they were not there. The archive is built in
 * `/tmp`, never on the drive, so it costs the drive no quota.
 *
 * It prints exactly one {@link RESULT_MARKER} line, success or not, and always
 * exits 0: a non-zero exit would read as "the command could not run" and lose
 * the reason.
 */
const SCRIPT = String.raw`
import base64, json, mimetypes, os, stat, sys, tempfile, urllib.error, urllib.request, zipfile

MARKER = ${JSON.stringify(RESULT_MARKER)}

def done(**result):
    sys.stdout.write(MARKER + json.dumps(result) + "\n")
    sys.stdout.flush()
    sys.exit(0)

params = json.loads(base64.b64decode(os.environ["LOBE_DRIVE_DOWNLOAD"]).decode("utf-8"))
root = os.path.realpath(os.getcwd())

def within(path, parent):
    return path == parent or path.startswith(parent.rstrip(os.sep) + os.sep)

hidden = [os.path.realpath(os.path.join(root, entry)) for entry in params.get("hidden", [])]

def is_hidden(path):
    return any(within(path, entry) for entry in hidden)

target = os.path.realpath(os.path.join(root, params["path"]))
if target == root or not within(target, root) or is_hidden(target) or not os.path.exists(target):
    done(ok=False, code="NOT_FOUND")

max_bytes = int(params["maxBytes"])
max_files = int(params["maxFiles"])
upload_path = None
cleanup = None

try:
    if os.path.isdir(target):
        base = os.path.dirname(target)
        files = []
        empty_dirs = []
        total = 0
        for current, dirnames, filenames in os.walk(target, followlinks=False):
            dirnames[:] = sorted(
                name for name in dirnames
                if not os.path.islink(os.path.join(current, name))
                and not is_hidden(os.path.join(current, name))
            )
            regular = []
            for name in sorted(filenames):
                path = os.path.join(current, name)
                try:
                    info = os.lstat(path)
                except OSError:
                    continue
                if not stat.S_ISREG(info.st_mode):
                    continue
                regular.append(path)
                total += info.st_size
            if not regular and not dirnames:
                empty_dirs.append(current)
            files.extend(regular)
            if total > max_bytes or len(files) > max_files:
                done(ok=False, code="TOO_LARGE", bytes=total, files=len(files))

        tmp_dir = "/tmp" if os.path.isdir("/tmp") else None
        handle, upload_path = tempfile.mkstemp(dir=tmp_dir, suffix=".zip")
        os.close(handle)
        cleanup = upload_path
        with zipfile.ZipFile(upload_path, "w", zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=1) as archive:
            for directory in empty_dirs:
                archive.write(directory, os.path.relpath(directory, base) + "/")
            for path in files:
                try:
                    archive.write(path, os.path.relpath(path, base))
                except OSError:
                    continue
        content_type = "application/zip"
        kind = "directory"
    else:
        info = os.stat(target)
        if not stat.S_ISREG(info.st_mode):
            done(ok=False, code="NOT_FOUND")
        if info.st_size > max_bytes:
            done(ok=False, code="TOO_LARGE", bytes=info.st_size, files=1)
        upload_path = target
        content_type = mimetypes.guess_type(target)[0] or "application/octet-stream"
        kind = "file"

    size = os.path.getsize(upload_path)
    headers = dict(params.get("headers") or {})
    headers["Content-Length"] = str(size)
    headers["Content-Type"] = content_type
    with open(upload_path, "rb") as body:
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
  hidden,
  maxBytes,
  maxFiles,
  path,
  uploadHeaders,
  uploadUrl,
}: DriveDownloadCommandParams) => {
  const payload = Buffer.from(
    JSON.stringify({ headers: uploadHeaders, hidden, maxBytes, maxFiles, path, uploadUrl }),
    'utf8',
  ).toString('base64');

  return `LOBE_DRIVE_DOWNLOAD='${payload}' python3 - <<'LOBE_DRIVE_DOWNLOAD_PY'\n${SCRIPT}\nLOBE_DRIVE_DOWNLOAD_PY`;
};

export type DriveDownloadOutcome =
  | { contentType: string; kind: 'directory' | 'file'; ok: true; size: number }
  | { bytes?: number; code: 'NOT_FOUND' | 'TOO_LARGE' | 'UPLOAD_FAILED'; ok: false };

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
    'DOWNLOAD_FAILED' | 'DOWNLOAD_TOO_LARGE' | 'DOWNLOAD_UNAVAILABLE' | 'PATH_NOT_FOUND';

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
    createPreSignedUpload: (key: string) => Promise<PreSignedUpload>;
  };
  hidden: string[];
  path: string;
  sandbox: Pick<SandboxService, 'callTool' | 'capabilities'>;
}

/**
 * Puts one file or folder of the drive where the browser can fetch it, and
 * answers with the link.
 *
 * The drive is only mounted inside a sandbox, so the bytes are read there and
 * uploaded from there straight to object storage; nothing passes through this
 * server. The object is a transient copy, not a library file: no file record
 * is made, so a download never shows up among the user's resources.
 */
export const prepareDriveDownload = async ({
  fileService,
  hidden,
  path,
  sandbox,
}: PrepareDriveDownloadParams) => {
  if (!sandbox.capabilities.shell) throw new DriveDownloadError('DOWNLOAD_UNAVAILABLE');

  const today = new Date().toISOString().split('T')[0];
  const key = `sandbox-drive-downloads/${today}/${randomUUID()}`;
  const upload = await fileService.createPreSignedUpload(key);

  const result = await sandbox.callTool('runCommand', {
    command: buildDriveDownloadCommand({
      hidden,
      maxBytes: DRIVE_DOWNLOAD_MAX_BYTES,
      maxFiles: DRIVE_DOWNLOAD_MAX_FILES,
      path,
      uploadHeaders: upload.headers,
      uploadUrl: upload.url,
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
    throw new DriveDownloadError('DOWNLOAD_FAILED', outcome.code);
  }

  const fileName = driveDownloadFileName(path, outcome.kind);
  const url = await fileService.createDownloadUrl(key, fileName, DRIVE_DOWNLOAD_URL_EXPIRES_IN);

  return { fileName, kind: outcome.kind, size: outcome.size, url };
};
