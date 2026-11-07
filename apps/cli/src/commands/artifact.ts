import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  extractHtmlTitle,
  gatherWorkspaceHtmlArtifact,
  hostedPath,
  packWorkspaceHtmlDocument,
} from '@lobechat/html-artifact';
import { artifactShareUrl } from '@lobechat/utils/artifactShare';
import { toRecord } from '@lobechat/utils/object';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient, type TrpcClient } from '../api/client';
import { resolveServerUrl } from '../settings';
import {
  createIdempotencyKey,
  readBinding,
  resolveManifest,
  writeBinding,
} from '../utils/artifactManifest';
import { formatError } from '../utils/error';
import { outputJson } from '../utils/format';
import { log } from '../utils/logger';
import { readLocalHtmlAsset } from '../utils/readLocalHtmlAsset';
import { publishCanvasArtifact } from './artifactCanvas';

interface PreparedUploadTarget {
  headers: Record<string, string>;
  path: string;
  uploadUrl: string;
}

interface DeploymentRecord {
  id?: string;
  latestRevisionNumber?: number;
  publicUrl?: string;
  slug?: string;
  status?: string;
  subdomainLabel?: string | null;
  title?: string | null;
}

/**
 * `market.deployments.*` only exists on the LobeHub Cloud server; the OSS
 * `LambdaRouter` this CLI is typed against ships an empty stub, so the calls
 * are described here and reached through a cast.
 */
type PublishTarget = { deploymentId: string; kind: 'deployment' } | { kind: 'create' };

interface MarketDeploymentClient {
  market: {
    deployments: {
      commitWorkspaceHtmlUpload: {
        mutate: (input: { uploadId: string }) => Promise<{ data: DeploymentRecord }>;
      };
      unpublish: {
        mutate: (input: { id: string }) => Promise<{ data: DeploymentRecord }>;
      };
      prepareWorkspaceHtmlUpload: {
        mutate: (input: {
          artifactIdentifier: string;
          files: { contentType: string; path: string; sizeBytes: number }[];
          idempotencyKey?: string;
          requestedSlug?: string;
          target: PublishTarget;
          title?: string;
        }) => Promise<{ data: { files: PreparedUploadTarget[]; uploadId: string } }>;
      };
    };
  };
}

const deploymentClient = (client: TrpcClient) => client as unknown as MarketDeploymentClient;

interface UploadEntry {
  body: Buffer;
  contentType: string;
  path: string;
}

/**
 * Mirrors what market compares before replaying an idempotent create: the
 * served files, the requested slug and the title. Entries are hashed in path
 * order because asset reads complete concurrently, so the gathered order can
 * differ between two runs of the same command.
 */
export const fingerprintCreate = (entries: UploadEntry[], requestedSlug: string, title: string) => {
  const hash = createHash('sha256').update(JSON.stringify([requestedSlug, title]));
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const entry of sorted) {
    hash.update(`\n${entry.path}\n${createHash('sha256').update(entry.body).digest('hex')}`);
  }
  return hash.digest('hex');
};

/**
 * A commit that failed without a definite answer: a server error (the
 * hosting service may have published before failing) or no response at all.
 * Rejections such as quota, size or an expired upload carry other codes.
 */
const isUnknownCommitOutcome = (error: unknown) => {
  const code = toRecord(toRecord(error)?.data)?.code;
  return code === undefined || code === 'INTERNAL_SERVER_ERROR';
};

/** Market's answer when a reused key carries a different request. */
const isIdempotencyConflict = (error: unknown) =>
  error instanceof Error && error.message.includes('Idempotency key was already used');

const fail = (message: string) => {
  log.error(message);
  process.exit(1);
};

const warnList = (label: string, items: string[]) => {
  if (items.length === 0) return;
  console.log(`${pc.yellow('!')} ${label}: ${items.join(', ')}`);
};

export function registerArtifactCommand(program: Command) {
  const artifact = program.command('artifact').description('Publish local pages as artifacts');

  artifact
    .command('guide <type>')
    .description('Read the generation guide for an artifact type (canvas)')
    .action(async (type: string) => {
      if (type !== 'canvas') {
        fail('The supported guide type is canvas.');
        return;
      }
      const client = await getTrpcClient();
      const { output } = await client.canvas.runAgentTool.mutate({
        apiName: 'readCanvasGuide',
        args: {},
      });
      if (!output.success) {
        fail(String(output.content));
        return;
      }
      console.log(output.content);
    });

  artifact
    .command('publish <file>')
    .description('Publish a local HTML file, bundling the assets it references')
    .option(
      '--root <dir>',
      'Directory the page may reference assets from (defaults to the working directory)',
    )
    .option('--deployment <id>', 'Publish to this deployment for this run only')
    .option('--new', 'Create a separate deployment instead of updating the bound one')
    .option(
      '--type <type>',
      'Artifact content type: html or canvas (defaults to the bound type, then html)',
    )
    .option('--title <title>', 'Override the page title')
    .option('--slug <slug>', 'Requested public slug')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        file: string,
        options: {
          json?: string | boolean;
          root?: string;
          slug?: string;
          title?: string;
          deployment?: string;
          new?: boolean;
          type?: string;
        },
      ) => {
        const entryPath = path.resolve(file);
        const rootDirectory = path.resolve(options.root ?? process.cwd());

        if (!entryPath.startsWith(`${rootDirectory}${path.sep}`) && entryPath !== rootDirectory) {
          fail(
            `${file} is outside ${rootDirectory}. Pass --root to widen the published directory.`,
          );
          return;
        }

        const entry = await readLocalHtmlAsset(entryPath);
        if (!entry.ok || entry.text === undefined) {
          fail(`Cannot read ${file}`);
          return;
        }

        const manifest = resolveManifest(entryPath, rootDirectory);
        const binding = readBinding(manifest);
        const type = options.type ?? binding.pendingType ?? binding.type ?? 'html';
        if (type !== 'html' && type !== 'canvas') {
          fail('Artifact type must be html or canvas.');
          return;
        }
        if (options.new && options.deployment) {
          fail('--new and --deployment cannot be combined.');
          return;
        }
        if (binding.pendingType && binding.pendingType !== type) {
          fail('Complete the pending publication before changing its type.');
          return;
        }
        if (type === 'canvas' && binding.pendingCreateKey && !binding.pendingCanvas) {
          fail('Complete the pending HTML publication before changing its type.');
          return;
        }
        if (
          !options.new &&
          options.type &&
          options.type !== (binding.pendingType ?? binding.type ?? 'html') &&
          (binding.deploymentId || binding.canvasId || binding.pendingCreateKey)
        ) {
          fail('Changing a bound artifact type requires --new.');
          return;
        }
        if (type === 'canvas') {
          try {
            const payload = await publishCanvasArtifact(await getTrpcClient(), {
              binding,
              deployment: options.deployment,
              html: entry.text,
              manifest,
              new: options.new,
              slug: options.slug || undefined,
              title:
                options.title ||
                extractHtmlTitle(entry.text) ||
                path.basename(entryPath, path.extname(entryPath)),
            });
            if (options.json !== undefined) {
              outputJson(payload, typeof options.json === 'string' ? options.json : undefined);
            } else {
              console.log(
                `${pc.green('✓')} Published Canvas ${payload.canvasId} (version ${payload.version})`,
              );
              console.log(`  URL: ${payload.publicUrl}`);
              console.log(`  Share: ${payload.shareUrl}`);
            }
          } catch (error) {
            const pending = readBinding(manifest).pendingCanvas;
            const saved = pending?.saved;
            if (options.json !== undefined)
              outputJson({ ...saved, error: formatError(error), success: false });
            fail(
              pending
                ? `${formatError(error)}. ${pending.rejectedPublication ? 'Correct the rejected slug and retry with the same content and target.' : 'Retry the same command with the original input to resume publication.'}`
                : formatError(error),
            );
          }
          return;
        }

        const gathered = await gatherWorkspaceHtmlArtifact({
          htmlContent: entry.text,
          htmlFilePath: entryPath,
          readAsset: readLocalHtmlAsset,
          workingDirectory: rootDirectory,
        });

        if (gathered.blocked === 'too-many') {
          fail('This page references too many local files to publish (limit is 64).');
          return;
        }
        if (gathered.blocked === 'too-large') {
          fail(`This page is too large to publish (${gathered.totalBytes} bytes, limit is 50MB).`);
          return;
        }

        const packed = packWorkspaceHtmlDocument({
          entryPath: gathered.entryPath,
          files: gathered.files,
        });

        if (packed.unresolvedHrefs.length > 0) {
          fail(`Could not resolve local references: ${packed.unresolvedHrefs.join(', ')}`);
          return;
        }

        warnList('Referenced files not found (widen with --root?)', gathered.missing);
        warnList('Too large to include', gathered.oversized);
        warnList('Unsupported file types, skipped', gathered.unsupported);

        const entries: UploadEntry[] = [
          {
            body: Buffer.from(packed.html, 'utf8'),
            contentType: 'text/html; charset=utf-8',
            path: '/index.html',
          },
          ...packed.sidecars.map((sidecar) => ({
            body: Buffer.from(sidecar.content, sidecar.encoding === 'base64' ? 'base64' : 'utf8'),
            contentType: sidecar.contentType,
            path: hostedPath(sidecar.path),
          })),
        ];

        const client = await getTrpcClient();
        const title = options.title || gathered.title;

        const boundDeploymentId = options.new
          ? undefined
          : (options.deployment ?? binding.deploymentId);
        const target: PublishTarget = boundDeploymentId
          ? { deploymentId: boundDeploymentId, kind: 'deployment' }
          : { kind: 'create' };

        const requestedSlug = options.slug || title;
        const fingerprint = fingerprintCreate(entries, requestedSlug, title);

        // Reuse a key left behind by a create whose response never arrived, so
        // the retry resolves to the deployment the server already made. Only the
        // same request may reuse it: market rejects a key replayed with other
        // content or title. A key recorded without a fingerprint predates this
        // check and is still reused; a conflict below then discards it.
        const reusesPendingKey =
          !!binding.pendingCreateKey &&
          (!binding.pendingCreateFingerprint || binding.pendingCreateFingerprint === fingerprint);
        const idempotencyKey =
          target.kind === 'create'
            ? reusesPendingKey
              ? binding.pendingCreateKey
              : createIdempotencyKey()
            : undefined;

        // Recorded before the request, not after: a create that succeeds and
        // then loses its response must still be recoverable on the next run.
        const persistsBinding = target.kind === 'create' && !options.deployment;
        if (
          persistsBinding &&
          (idempotencyKey !== binding.pendingCreateKey ||
            fingerprint !== binding.pendingCreateFingerprint)
        ) {
          writeBinding(manifest, {
            ...binding,
            pendingCreateFingerprint: fingerprint,
            pendingCreateKey: idempotencyKey,
            pendingType: 'html',
          });
        }

        const deployments = deploymentClient(client).market.deployments;

        const prepared = await deployments.prepareWorkspaceHtmlUpload.mutate({
          artifactIdentifier: gathered.identifier,
          files: entries.map((item) => ({
            contentType: item.contentType,
            path: item.path,
            sizeBytes: item.body.byteLength,
          })),
          idempotencyKey,
          requestedSlug,
          target,
          title,
        });

        for (const uploadTarget of prepared.data.files) {
          const source = entries.find((item) => item.path === uploadTarget.path);
          if (!source) {
            fail(`Server asked for an unknown file: ${uploadTarget.path}`);
            return;
          }

          const response = await fetch(uploadTarget.uploadUrl, {
            body: source.body,
            headers: uploadTarget.headers,
            method: 'PUT',
          });

          if (!response.ok) {
            fail(
              `Upload failed for ${uploadTarget.path}: ${response.status} ${response.statusText}`,
            );
            return;
          }
        }

        let result: { data: DeploymentRecord };
        try {
          result = await deployments.commitWorkspaceHtmlUpload.mutate({
            uploadId: prepared.data.uploadId,
          });
        } catch (error) {
          if (persistsBinding && isIdempotencyConflict(error)) {
            // The earlier unconfirmed create went live with other content; its
            // key can never publish this request, so drop it for the next run.
            const {
              pendingCreateFingerprint: _fingerprint,
              pendingCreateKey: _key,
              pendingType: _type,
              ...rest
            } = readBinding(manifest);
            writeBinding(manifest, rest);
            fail(
              'An earlier unconfirmed publish of this file already went live with different content, so this version was not published. Run the command again to publish it.',
            );
            return;
          }
          if (!isUnknownCommitOutcome(error)) {
            fail(formatError(error));
            return;
          }
          // The outcome is unknown, not failed: the site may be live. Retrying
          // reuses the recorded key (create) or the same target (update), so it
          // returns that site instead of publishing a second one.
          fail(
            `${formatError(error).replace(/\.$/, '')}. Run the same command again to finish publishing; it will not create a second site.`,
          );
          return;
        }

        if (persistsBinding && result.data.id) {
          writeBinding(manifest, { deploymentId: result.data.id });
        }

        const shareUrl = result.data.id
          ? artifactShareUrl(resolveServerUrl(), result.data.id)
          : undefined;
        const payload = { ...result.data, shareUrl };

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(payload, fields);
          return;
        }

        console.log(`${pc.green('✓')} Published ${pc.bold(title)} (${entries.length} file(s))`);
        if (payload.publicUrl) console.log(`  URL: ${pc.dim(payload.publicUrl)}`);
        if (shareUrl) console.log(`  Share: ${pc.dim(shareUrl)}`);
        console.log(`  Deployment: ${pc.dim(result.data.id ?? '')}`);
      },
    );

  artifact
    .command('unpublish [file]')
    .description('Take a published artifact offline, keeping the deployment and its releases')
    .option('--deployment <id>', 'Unpublish this deployment instead of the one bound to the file')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        file: string | undefined,
        options: { deployment?: string; json?: string | boolean },
      ) => {
        let deploymentId = options.deployment;

        if (!deploymentId) {
          if (!file) {
            fail('Pass the published file, or --deployment <id>.');
            return;
          }

          const manifest = resolveManifest(path.resolve(file), process.cwd());
          deploymentId = readBinding(manifest).deploymentId;
          if (!deploymentId) {
            fail(`${file} is not bound to a deployment. Pass --deployment <id> to unpublish one.`);
            return;
          }
        }

        const deployments = deploymentClient(await getTrpcClient()).market.deployments;
        let data: DeploymentRecord;
        try {
          ({ data } = await deployments.unpublish.mutate({ id: deploymentId }));
        } catch (error) {
          if (options.json !== undefined) outputJson({ error: formatError(error), success: false });
          fail(formatError(error));
          return;
        }

        if (options.json !== undefined) {
          outputJson(data, typeof options.json === 'string' ? options.json : undefined);
          return;
        }

        console.log(
          `${pc.green('✓')} Unpublished ${pc.bold(data.title ?? deploymentId)} (${deploymentId})`,
        );
        // The record survives so republishing the same file brings the same
        // address back, which is also why this is not a delete.
        if (file) console.log(`  Republish: ${pc.dim(`lh artifact publish ${file}`)}`);
      },
    );
}
