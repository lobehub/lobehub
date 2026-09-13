import path from 'node:path';

import {
  gatherWorkspaceHtmlArtifact,
  hostedPath,
  packWorkspaceHtmlDocument,
} from '@lobechat/html-artifact';
import { artifactShareUrl } from '@lobechat/utils/artifactShare';
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
import { outputJson } from '../utils/format';
import { log } from '../utils/logger';
import { readLocalHtmlAsset } from '../utils/readLocalHtmlAsset';

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
    .command('publish <file>')
    .description('Publish a local HTML file, bundling the assets it references')
    .option(
      '--root <dir>',
      'Directory the page may reference assets from (defaults to the working directory)',
    )
    .option('--deployment <id>', 'Publish to this deployment for this run only')
    .option('--new', 'Create a separate deployment instead of updating the bound one')
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

        const manifest = resolveManifest(entryPath, rootDirectory);
        const binding = readBinding(manifest);

        if (options.new && options.deployment) {
          fail('--new and --deployment cannot be combined.');
          return;
        }

        const boundDeploymentId = options.new
          ? undefined
          : (options.deployment ?? binding.deploymentId);
        const target: PublishTarget = boundDeploymentId
          ? { deploymentId: boundDeploymentId, kind: 'deployment' }
          : { kind: 'create' };

        // Reuse a key left behind by a create whose response never arrived, so
        // the retry resolves to the deployment the server already made.
        const idempotencyKey =
          target.kind === 'create'
            ? (binding.pendingCreateKey ?? createIdempotencyKey())
            : undefined;

        // Recorded before the request, not after: a create that succeeds and
        // then loses its response must still be recoverable on the next run.
        const persistsBinding = target.kind === 'create' && !options.deployment;
        if (persistsBinding && idempotencyKey !== binding.pendingCreateKey) {
          writeBinding(manifest, { ...binding, pendingCreateKey: idempotencyKey });
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
          requestedSlug: options.slug || title,
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

        const result = await deployments.commitWorkspaceHtmlUpload.mutate({
          uploadId: prepared.data.uploadId,
        });

        if (persistsBinding && result.data.id) {
          writeBinding(manifest, { deploymentId: result.data.id });
        }

        const publicUrl = result.data.id
          ? artifactShareUrl(resolveServerUrl(), result.data.id)
          : result.data.publicUrl;
        const payload = { ...result.data, publicUrl };

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(payload, fields);
          return;
        }

        console.log(`${pc.green('✓')} Published ${pc.bold(title)} (${entries.length} file(s))`);
        if (publicUrl) console.log(`  URL: ${pc.dim(publicUrl)}`);
        console.log(`  Deployment: ${pc.dim(result.data.id ?? '')}`);
      },
    );
}
