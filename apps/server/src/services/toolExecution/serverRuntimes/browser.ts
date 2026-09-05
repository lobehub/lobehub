import { BrowserIdentifier, BrowserManifest } from '@lobechat/builtin-tool-browser';
import debug from 'debug';

import { deviceGateway } from '@/server/services/deviceGateway';
import { FileService } from '@/server/services/file';

import { buildNoActiveDeviceResult, REMOTE_DEVICE_TOOL_IDENTIFIER } from './noActiveDevice';
import { resolveContentWorkspaceId, resolveRunWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

/**
 * Browser tool server runtime.
 *
 * A cloud agent run can't touch a device's renderer directly, so each browser
 * api call is proxied back to the bound device through `deviceGateway`. The
 * device daemon forwards it to the desktop renderer, which runs the exact same
 * client `browserExecutor` (mount webview / snapshot / click / …) verified for
 * the local runtime — so there is one behavioral source of truth.
 *
 * The browser session on the device is keyed by `topic:<topicId>`. The gateway
 * tool-call envelope only carries `apiName` + `arguments`, so the runtime rides
 * the run's identity in the args (mirroring how localSystem injects `cwd`); the
 * device strips it back out before invoking the executor.
 */
const log = debug('lobe-server:browser-runtime');

/** `data:image/png;base64,…` → the media type and the payload. */
const DATA_URL_RE = /^data:(image\/[\w.+-]+);base64,(.+)$/;

/** Filename extension per IANA media type, mirroring the heterogeneous uploader. */
const IMAGE_EXT_BY_MEDIA_TYPE: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Turn the screenshot's inline `dataUrl` into a stored file, exposed on
 * `state.images` as `{ fileId, mediaType, url }`.
 *
 * This is the same contract the heterogeneous pipeline already produces for a
 * tool_result image (`AgentStreamPipeline.uploadResultImages` →
 * `createFileStoreImageUploader`), and the one `MessageContent` reads to hand
 * a vision model real `image_url` parts. Proxying the device's `dataUrl`
 * verbatim left this runtime as the only image-producing tool with no file
 * behind it: the model could not see its own screenshot, and nothing
 * downstream — Acceptance evidence included — had an id to cite.
 *
 * The stored id is also named in `content`: `state` reaches the model as image
 * parts, not as text, so a builder that has to cite the artifact (Acceptance
 * evidence) would otherwise be able to see the screenshot without ever learning
 * its id. It doubles as the only signal a non-vision model gets, since the
 * device returns an empty `content` for this api.
 *
 * The file is created under the CONTENT workspace, not the gateway-addressing
 * one: a workspace run routed to a personal device still writes workspace data,
 * and some dispatch/resume paths never thread `workspaceId` into the tool
 * context at all — so a raw `context.workspaceId` would file the evidence in
 * personal scope where a workspace-scoped lookup cannot reach it.
 *
 * Best-effort by construction: the capture succeeded either way, so an upload
 * failure degrades to the previous pass-through instead of failing the call.
 * `dataUrl` is dropped once stored so the base64 never reaches the DB.
 */
const storeScreenshot = async (
  result: { content?: string; state?: unknown; success?: boolean },
  context: { agentId?: string; serverDB?: unknown; userId?: string; workspaceId?: string },
) => {
  const state = result.state as { dataUrl?: string } | undefined;
  const match =
    result.success !== false && typeof state?.dataUrl === 'string'
      ? state.dataUrl.match(DATA_URL_RE)
      : null;
  if (!match || !context.serverDB || !context.userId) return result;

  const [, mediaType, base64Data] = match;
  try {
    const workspaceId = await resolveContentWorkspaceId(context as never);
    const fileService = new FileService(context.serverDB as never, context.userId, workspaceId);
    const date = new Date().toISOString().slice(0, 10);
    const ext = IMAGE_EXT_BY_MEDIA_TYPE[mediaType] ?? 'png';
    const { fileId, url } = await fileService.uploadBase64(
      base64Data,
      `files/${date}/browser-screenshot-${Date.now()}.${ext}`,
      { fileType: mediaType },
    );

    // `dataUrl` carried both the model's copy and the chat renderer's `src`.
    // Dropping it (so the base64 never reaches the DB) must not blank the
    // screenshot in chat, so the stored URL takes its place as the renderable
    // field; the client executor path still supplies `dataUrl` directly.
    const { dataUrl: _dropped, ...rest } = state!;
    return {
      ...result,
      content: `Screenshot captured and stored as file ${fileId}. Cite that id when a tool asks for a fileId.`,
      state: { ...rest, images: [{ fileId, mediaType, url }], url },
    };
  } catch (error) {
    log('screenshot upload failed, passing the capture through inline: %O', error);
    return result;
  }
};

export const browserRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Browser device proxy execution');
    }
    // No active device: `activeDeviceId` is legitimately empty in device-capable
    // runs (never bound yet, or the device dropped offline mid-run and the plan
    // re-resolved to `device-unrouted`). Historically this guard threw a bare
    // error string with no recovery path — the model kept stalling on it (see
    // agent vent reports). Return a structured, actionable result per API call
    // instead: the model is told exactly how to recover (activate a device, or
    // ask the user to reconnect) rather than hitting an opaque failure.
    if (!context.activeDeviceId) {
      const noDevice = buildNoActiveDeviceResult('Browser device proxy', {
        remoteDeviceToolAvailable: context.toolManifestMap
          ? REMOTE_DEVICE_TOOL_IDENTIFIER in context.toolManifestMap
          : true,
      });

      const proxy: Record<string, (args: any) => Promise<any>> = {};
      for (const api of BrowserManifest.api) {
        proxy[api.name] = async () => noDevice;
      }
      return proxy;
    }
    if (!context.agentId) {
      throw new Error('agentId is required for Browser device proxy execution');
    }
    if (!context.topicId) {
      throw new Error('topicId is required for Browser device proxy execution');
    }

    let workspaceIdPromise: Promise<string | undefined> | undefined;
    const getDeviceWorkspaceId = () => (workspaceIdPromise ??= resolveRunWorkspaceId(context));

    const proxy: Record<string, (args: any) => Promise<any>> = {};

    for (const api of BrowserManifest.api) {
      proxy[api.name] = async (args: any) => {
        // Carry the run identity so the device resolves the right browser
        // session (`topic:<topicId>`); the agentId rides along so the device can
        // decide whether revealing the panel would yank the user's view. Both
        // are stripped device-side.
        const finalArgs = { ...args, __agentId: context.agentId, __topicId: context.topicId };

        const result = await deviceGateway.executeToolCall(
          {
            deviceId: context.activeDeviceId!,
            operationId: context.operationId,
            userId: context.userId!,
            workspaceId: await getDeviceWorkspaceId(),
          },
          {
            apiName: api.name,
            arguments: JSON.stringify(finalArgs),
            identifier: BrowserIdentifier,
          },
          context.executionTimeoutMs,
        );

        return api.name === 'screenshot' ? storeScreenshot(result, context) : result;
      };
    }

    return proxy;
  },
  identifier: BrowserIdentifier,
};
