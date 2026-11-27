import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { x } from 'tinyexec';

/**
 * needy publishes one archive per target with a `.sha256` file beside it.
 *
 * Source: https://github.com/needy-dev/needy/releases/tag/v0.0.22 (asset names, read 2026-11-27)
 * Reference: https://github.com/needy-dev/needy/blob/de4a56b/.github/workflows/release.yml
 * NOTICE: the archive holds `needy` and the Linux guest binary; only `needy` is extracted.
 */
const RELEASE_BASE_URL = 'https://github.com/needy-dev/needy/releases/download';

/** needy's Rust target triples for the hosts it ships an executor runner for. */
const RELEASE_TARGETS: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
};
// TODO(needy-windows): Windows ships `needy-x86_64-pc-windows-msvc.zip` and can
// host an executor runner, but needy's `--credential-file` needs private-file
// ACLs it does not implement on Windows yet (`TODO(windows-acl)` in needy).
// Unlock when needy reads a credential file on Windows.

/** A release version as needy tags it, without the `v`: `MAJOR.MINOR.PATCH`. */
export const NEEDY_VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Downloads and checks one archive; a stalled mirror must not hold an attach forever. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** needy's target triple for this host, or `undefined` when it has no executor build. */
export const resolveNeedyTarget = (
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined => RELEASE_TARGETS[`${platform}-${arch}`];

export interface NeedyReleaseOptions {
  /** Root of the cache; each version lives in `<cacheDir>/<version>/needy`. */
  cacheDir: string;
  /** Injected for tests; defaults to the system `tar`. */
  extract?: (archive: string, member: string, destination: string) => Promise<void>;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injected for tests; waits between download retries. */
  sleep?: (ms: number) => Promise<void>;
  target?: string;
}

/**
 * NOTICE: the CLI has no tar dependency, and the archive is a plain gzip tar
 * with the binary at its root, so the system `tar` (macOS, Linux, and bsdtar
 * on Windows 10+) extracts the one member needed.
 */
const extractWithSystemTar = async (archive: string, member: string, destination: string) => {
  const result = await x('tar', ['-xzf', archive, '-C', destination, member], {
    throwOnError: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(`tar could not extract ${member}: ${result.stderr.trim() || result.exitCode}`);
  }
};

/**
 * Pauses before each retry of a download. GitHub's release asset host resets
 * connections now and then; a retry almost always gets through.
 */
const DOWNLOAD_RETRY_DELAYS_MS = [1000, 3000];

class HttpStatusError extends Error {
  constructor(
    url: string,
    readonly status: number,
  ) {
    super(`download of ${url} failed with HTTP ${status}`);
  }
}

const download = async (
  fetchImpl: typeof fetch,
  url: string,
  sleep: (ms: number) => Promise<void>,
): Promise<Buffer> => {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) throw new HttpStatusError(url, response.status);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      const delay = DOWNLOAD_RETRY_DELAYS_MS[attempt];
      // A 4xx (a version that was never released) will not change on a retry.
      const permanent = error instanceof HttpStatusError && error.status < 500;
      if (delay === undefined || permanent) throw error;
      await sleep(delay);
    }
  }
};

const exists = async (file: string) => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

/**
 * The needy binary of one release, downloaded once into the cache and checked
 * against the release's published SHA-256 before it is ever run.
 *
 * Concurrent calls for one version share a download; a finished binary is
 * moved into place with a rename, so a crash leaves no half-written `needy`.
 */
export class NeedyRelease {
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly options: NeedyReleaseOptions) {}

  /** The path of `needy` for `version`, downloading it on first use. */
  binary(version: string): Promise<string> {
    const running = this.pending.get(version);
    if (running) return running;
    const next = this.install(version).finally(() => this.pending.delete(version));
    this.pending.set(version, next);
    return next;
  }

  private async install(version: string): Promise<string> {
    // The version names a cache directory and a URL path; nothing else gets in.
    if (!NEEDY_VERSION_PATTERN.test(version)) throw new Error(`invalid needy version ${version}`);
    const versionDir = path.join(this.options.cacheDir, version);
    const binary = path.join(versionDir, 'needy');
    if (await exists(binary)) return binary;

    const target = this.options.target ?? resolveNeedyTarget();
    if (!target) {
      throw new Error(`needy has no executor build for ${process.platform}-${process.arch}`);
    }
    const fetchImpl = this.options.fetch ?? fetch;
    const sleep =
      this.options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const archiveName = `needy-${target}.tar.gz`;
    const archiveUrl = `${RELEASE_BASE_URL}/v${version}/${archiveName}`;

    const [archive, checksumFile] = await Promise.all([
      download(fetchImpl, archiveUrl, sleep),
      download(fetchImpl, `${archiveUrl}.sha256`, sleep),
    ]);
    // The `.sha256` file holds the hex digest, optionally followed by the file name.
    const expected = checksumFile.toString('utf8').trim().split(/\s+/)[0]?.toLowerCase();
    const actual = createHash('sha256').update(archive).digest('hex');
    if (!expected || expected !== actual) {
      throw new Error(`${archiveName} does not match its published SHA-256`);
    }
    // TODO(needy-attestation): needy also publishes build provenance attestations;
    // verifying them needs a Sigstore client the CLI does not carry. The SHA-256
    // checks the transfer, not the publisher.

    await fs.mkdir(versionDir, { mode: 0o700, recursive: true });
    const staging = await fs.mkdtemp(path.join(versionDir, `.staging-${randomUUID()}-`));
    try {
      const archivePath = path.join(staging, archiveName);
      await fs.writeFile(archivePath, archive, { mode: 0o600 });
      await (this.options.extract ?? extractWithSystemTar)(archivePath, 'needy', staging);
      const staged = path.join(staging, 'needy');
      await fs.chmod(staged, 0o700);
      await fs.rename(staged, binary);
    } finally {
      await fs.rm(staging, { force: true, recursive: true });
    }
    return binary;
  }
}
