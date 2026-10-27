import { createHash } from 'node:crypto';

import { artifactShareUrl } from '@lobechat/utils/artifactShare';
import { toRecord } from '@lobechat/utils/object';

import type { TrpcClient } from '../api/client';
import { resolveServerUrl } from '../settings';
import {
  type ArtifactBinding,
  createIdempotencyKey,
  type ResolvedManifest,
  writeBinding,
} from '../utils/artifactManifest';

export const publishCanvasArtifact = async (
  client: TrpcClient,
  params: {
    binding: ArtifactBinding;
    deployment?: string;
    html: string;
    manifest: ResolvedManifest;
    new?: boolean;
    slug?: string;
    title: string;
  },
) => {
  const { binding, html, manifest, title } = params;
  const context = await client.canvas.getPublishContext.query();
  if (!context.canPublish) throw new Error('Canvas publishing is unavailable on this server');
  const scope = JSON.stringify([resolveServerUrl(), context.userId, context.workspaceId]);
  if (binding.scope && binding.scope !== scope) {
    throw new Error('This artifact is bound to a different server, account or workspace');
  }
  const fingerprintFor = (slug?: string) =>
    createHash('sha256')
      .update(
        JSON.stringify([
          html,
          title,
          params.deployment ?? null,
          !!params.new,
          ...(slug ? [slug] : []),
        ]),
      )
      .digest('hex');
  const fingerprint = fingerprintFor(params.slug);
  let pending = binding.pendingCanvas;
  if (
    pending &&
    pending.fingerprint !== fingerprint &&
    (!pending.saved ||
      !pending.rejectedPublication ||
      pending.fingerprint !== fingerprintFor(pending.rejectedPublication.requestedSlug))
  ) {
    throw new Error(
      'A publication is pending with different content or options; retry the original input first',
    );
  }
  if (!pending) {
    const canvasId = params.new ? undefined : binding.canvasId;
    const current = canvasId ? await client.canvas.getVersion.query({ canvasId }) : null;
    if (canvasId && (!current || !current.canPublish)) {
      throw new Error('The bound Canvas is unavailable or cannot be published by this account');
    }
    pending = {
      canvasId,
      createNew: !!params.new,
      deploymentId: params.deployment,
      expectedVersion: current?.version ?? 0,
      fingerprint,
      previous: binding,
    };
  }
  pending = { ...pending, fingerprint, rejectedPublication: undefined };
  const pendingCreateKey = binding.pendingCreateKey ?? createIdempotencyKey();
  const activeBinding: ArtifactBinding = {
    ...binding,
    pendingCanvas: pending,
    pendingCreateKey,
    scope,
    pendingType: 'canvas',
  };
  writeBinding(manifest, activeBinding);

  let saved = pending.saved;
  if (!saved) {
    try {
      saved = await client.canvas.save.mutate({
        canvasId: pending.canvasId,
        expectedVersion: pending.expectedVersion,
        html,
        requestId: pendingCreateKey,
        title,
      });
    } catch (error) {
      const code = toRecord(toRecord(error)?.data)?.code;
      if (
        code === 'BAD_REQUEST' ||
        code === 'CONFLICT' ||
        code === 'FORBIDDEN' ||
        code === 'NOT_FOUND'
      ) {
        const previous = pending.previous;
        writeBinding(
          manifest,
          previous.canvasId || previous.deploymentId ? previous : { ...previous, type: 'canvas' },
        );
      }
      throw error;
    }
  }
  writeBinding(manifest, { ...activeBinding, pendingCanvas: { ...pending, saved } });
  const published = await client.canvas.publish
    .mutate({
      canvasId: saved.canvasId,
      deploymentId: params.deployment,
      requestedSlug: params.slug,
      version: saved.version,
    })
    .catch((error) => {
      if (toRecord(toRecord(error)?.data)?.code === 'BAD_REQUEST') {
        writeBinding(manifest, {
          ...activeBinding,
          pendingCanvas: {
            ...pending,
            saved,
            rejectedPublication: { requestedSlug: params.slug },
          },
        });
      }
      throw error;
    });
  writeBinding(
    manifest,
    params.deployment
      ? pending.previous
      : {
          ...saved,
          deploymentId: published.deploymentId,
          scope,
          type: 'canvas',
        },
  );
  return {
    ...saved,
    id: published.deploymentId,
    publicUrl: published.url,
    publishedVersion: published.publishedVersion,
    shareUrl: artifactShareUrl(resolveServerUrl(), published.deploymentId),
    subdomainLabel: published.subdomainLabel,
  };
};
