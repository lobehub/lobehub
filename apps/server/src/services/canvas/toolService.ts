import type {
  CanvasReadOutcome,
  CanvasSaveOutcome,
  CanvasSummary,
  CanvasToolService,
  CreateCanvasParams,
  ReadCanvasParams,
  UpdateCanvasParams,
} from '@lobechat/builtin-tool-canvas';
import {
  applyCanvasChanges,
  type CanvasChangeSet,
  collectCanvasFileRefs,
  isCanvasTextPath,
  normalizeCanvasPath,
} from '@lobechat/canvas';
import { nanoid } from '@lobechat/utils';

import type { WorkModel } from '@/database/models/work';

import type { CanvasFileRefResolution, CanvasFileRefResolver } from './fileRefs';
import type { CanvasStorageService } from './storage';

const READ_TEXT_CHAR_BUDGET = 60_000;

interface CanvasToolServiceDeps {
  agentId?: string | null;
  findGuideState: () => Promise<unknown>;
  resolveFileRefs?: CanvasFileRefResolver;
  storage: CanvasStorageService;
  storageFor: (ownerId: string) => CanvasStorageService;
  topicId?: string | null;
  workModel: WorkModel;
}

const ownerOnly = (canvasId: string): CanvasSaveOutcome => ({
  error: `Canvas "${canvasId}" belongs to another member; only its owner can update it. Read it and create a new canvas instead.`,
  issues: [],
  ok: false,
});

const notFound = (canvasId: string): CanvasSaveOutcome => ({
  error: `Canvas "${canvasId}" was not found.`,
  issues: [],
  ok: false,
});

export class CanvasToolServiceImpl implements CanvasToolService {
  private deps: CanvasToolServiceDeps;

  constructor(deps: CanvasToolServiceDeps) {
    this.deps = deps;
  }

  hasReadGuide = async () => {
    if (!this.deps.topicId) return true;
    const state = (await this.deps.findGuideState()) as { guideRead?: boolean } | undefined;
    return state?.guideRead === true;
  };

  private resolveFileRefs = async (changes: CanvasChangeSet): Promise<CanvasFileRefResolution> => {
    const writes = collectCanvasFileRefs(changes);
    if (writes.length === 0 || !this.deps.resolveFileRefs)
      return { contents: new Map(), issues: [] };
    return this.deps.resolveFileRefs(writes);
  };

  create = async (params: CreateCanvasParams): Promise<CanvasSaveOutcome> => {
    const fileRefs = await this.resolveFileRefs({ writes: params.files });
    if (fileRefs.issues.length > 0) return { issues: fileRefs.issues, ok: false };

    const changes = applyCanvasChanges(new Map(), { writes: params.files }, fileRefs.contents);
    if (!changes.ok) return { error: changes.error, issues: [], ok: false };

    const canvasId = `cvs_${nanoid()}`;
    const result = await this.deps.storage.commit(canvasId, changes.files);
    if (!result.ok) return { issues: result.issues, ok: false };

    return {
      canvasId,
      description: params.description ?? null,
      metadata: result.metadata,
      ok: true,
      title: params.title,
    };
  };

  update = async (params: UpdateCanvasParams): Promise<CanvasSaveOutcome> => {
    const current = await this.deps.workModel.findCanvas(params.canvasId);
    const manifestKey = current?.version.metadata?.canvas?.manifestKey;
    if (!current || !manifestKey) return notFound(params.canvasId);
    if (current.work.userId !== this.deps.storage.ownerId) return ownerOnly(params.canvasId);

    const fileRefs = await this.resolveFileRefs(params);
    if (fileRefs.issues.length > 0) return { issues: fileRefs.issues, ok: false };

    const base = await this.deps.storage.loadProject(
      await this.deps.storage.readManifest(manifestKey),
    );
    const changes = applyCanvasChanges(base, params, fileRefs.contents);
    if (!changes.ok) return { error: changes.error, issues: [], ok: false };

    const result = await this.deps.storage.commit(params.canvasId, changes.files);
    if (!result.ok) return { issues: result.issues, ok: false };

    return {
      canvasId: params.canvasId,
      description: params.description ?? current.work.description,
      metadata: result.metadata,
      ok: true,
      title: params.title ?? current.work.title ?? 'Untitled',
    };
  };

  read = async (params: ReadCanvasParams): Promise<CanvasReadOutcome | undefined> => {
    const current = await this.deps.workModel.findCanvas(params.canvasId);
    const manifestKey = current?.version.metadata?.canvas?.manifestKey;
    if (!current || !manifestKey) return;

    const storage = this.deps.storageFor(current.work.userId);
    const manifest = await storage.readManifest(manifestKey);
    const requested = params.paths?.map((path) => normalizeCanvasPath(path));
    const texts: CanvasReadOutcome['texts'] = [];
    let budget = READ_TEXT_CHAR_BUDGET;

    for (const path of Object.keys(manifest.files)) {
      if (!isCanvasTextPath(path)) continue;
      if (requested && !requested.includes(path)) continue;
      const file = await storage.readFile(manifest, path);
      if (!file) continue;
      const content = new TextDecoder().decode(file.bytes);
      if (content.length > budget) {
        texts.push({ content: `[${content.length} characters; read this file on its own]`, path });
        continue;
      }
      budget -= content.length;
      texts.push({ content, path });
    }

    return {
      canvasId: params.canvasId,
      description: current.work.description,
      files: Object.entries(manifest.files).map(([path, entry]) => ({ path, size: entry.size })),
      texts,
      title: current.work.title,
    };
  };

  list = async (): Promise<CanvasSummary[]> => {
    const works = await this.deps.workModel.listCanvases({ agentId: this.deps.agentId });

    return works.map((work) => ({
      canvasId: work.resourceId!,
      description: work.description,
      title: work.title,
      updatedAt: new Date(work.updatedAt).toISOString(),
    }));
  };
}
