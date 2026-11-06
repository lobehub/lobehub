import type {
  ArtboardContent,
  BuiltinServerRuntimeOutput,
  WorkRegistrationIntent,
} from '@lobechat/types';

import {
  ArtboardApiName,
  type ArtboardToolFailure,
  type ArtboardToolService,
  type ArtboardToolSnapshot,
  type ArtboardToolState,
  type CreateArtboardParams,
  type ReadArtboardParams,
  type UpdateArtboardParams,
} from '../types';

interface ArtboardRuntimeContext {
  onWorkRegistration?: (intent: WorkRegistrationIntent) => void;
}

export const describeArtboardContent = (content: ArtboardContent) =>
  `${content.groups.length} groups · ${content.frames.length} frames`;

const toState = (artboard: ArtboardToolSnapshot, changedIds: string[]): ArtboardToolState => ({
  artboardId: artboard.id,
  changedIds,
  frameCount: artboard.content.frames.length,
  groupCount: artboard.content.groups.length,
  phase: artboard.phase,
  revision: artboard.revision,
  title: artboard.title,
});

const HINTS: Record<string, string> = {
  conflict: `Call ${ArtboardApiName.readArtboard} for the latest revision, then apply your change to it.`,
  exists: `Use ${ArtboardApiName.readArtboard} and ${ArtboardApiName.updateArtboard} on that board instead.`,
  locked: 'Change other groups or notes instead, or tell the user the journey is finalized.',
};

const failure = (outcome: ArtboardToolFailure): BuiltinServerRuntimeOutput => ({
  content: [outcome.message, HINTS[outcome.code]].filter(Boolean).join(' '),
  error: { message: outcome.message, type: outcome.code },
  success: false,
});

const formatBoard = (artboard: ArtboardToolSnapshot) => {
  const { arrows, frames, groups, notes } = artboard.content;
  const source = (frame: (typeof frames)[number]) =>
    frame.source.kind === 'canvas'
      ? `canvas ${frame.source.canvasId} v${frame.source.version}${frame.source.path ? ` ${frame.source.path}` : ''}`
      : `image ${frame.source.fileId}`;
  return [
    `Artboard ${artboard.id} "${artboard.title}" · revision ${artboard.revision} · ${artboard.phase}`,
    'Groups:',
    ...groups.map((g) => `- ${g.id} [${g.kind}] ${g.title}${g.desc ? ` — ${g.desc}` : ''}`),
    'Frames:',
    ...frames.map(
      (f) =>
        `- ${f.id} in ${f.groupId} "${f.title}" at (${f.x}, ${f.y}) ${source(f)}${f.recommended ? ' recommended' : ''}${f.check ? ` check: ${f.check.expected}` : ''}`,
    ),
    'Arrows:',
    ...arrows.map((a) => `- ${a.id} ${a.from} → ${a.to} "${a.label}"`),
    'Notes:',
    ...notes.map((n) => {
      const question = n.question
        ? n.question.status === 'decided'
          ? ` decided: ${n.question.decision}`
          : ` open question${n.question.suggestion ? ` (suggestion: ${n.question.suggestion})` : ''}`
        : '';
      return `- ${n.id} ${n.kind} "${n.text}" at (${n.x}, ${n.y})${question}`;
    }),
  ].join('\n');
};

export class ArtboardExecutionRuntime {
  constructor(private service: ArtboardToolService) {}

  async createArtboard(
    params: CreateArtboardParams,
    context?: ArtboardRuntimeContext,
  ): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.create(params);
    if (!outcome.ok) return failure(outcome);

    const { artboard, changedIds, task } = outcome;
    context?.onWorkRegistration?.({
      action: 'register',
      artboard: {
        artboardId: artboard.id,
        changeType: 'created',
        description: artboard.description,
        projectId: artboard.projectId,
        title: artboard.title,
        toolName: ArtboardApiName.createArtboard,
      },
      type: 'artboard',
    });

    const taskNote = task
      ? ` for task ${task.identifier}${task.createdTask ? ' (new task)' : ''}`
      : '';
    return {
      content: `Created artboard ${artboard.id} "${artboard.title}"${taskNote} · revision ${artboard.revision} · ${describeArtboardContent(artboard.content)}. The user sees it as a card under your reply; use ${ArtboardApiName.updateArtboard} with this id and revision for changes.`,
      state: toState(artboard, changedIds),
      success: true,
    };
  }

  async updateArtboard(params: UpdateArtboardParams): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.update(params);
    if (!outcome.ok) return failure(outcome);

    const { artboard, changedIds } = outcome;
    return {
      content: `Updated artboard ${artboard.id} · revision ${artboard.revision} · ${describeArtboardContent(artboard.content)}. Changed: ${changedIds.join(', ') || 'nothing'}.`,
      state: toState(artboard, changedIds),
      success: true,
    };
  }

  async readArtboard(params: ReadArtboardParams): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.read(params);
    if (!outcome.ok) return failure(outcome);

    const { artboard, canvases, staleFrameIds } = outcome;
    const stale = staleFrameIds.flatMap((frameId) => {
      const frame = artboard.content.frames.find((f) => f.id === frameId);
      if (frame?.source.kind !== 'canvas') return [];
      const latest = canvases[frame.source.canvasId]?.latestVersion;
      return [
        `- ${frame.id} shows Canvas ${frame.source.canvasId} v${frame.source.version}, latest is v${latest}`,
      ];
    });
    return {
      content: [
        formatBoard(artboard),
        ...(stale.length ? ['Frames behind their Canvas:', ...stale] : []),
      ].join('\n'),
      state: { ...toState(artboard, []), staleFrameIds },
      success: true,
    };
  }

  async listArtboards(): Promise<BuiltinServerRuntimeOutput> {
    const outcome = await this.service.list();
    if (!outcome.ok) return failure(outcome);
    if (!outcome.artboards.length)
      return {
        content: 'No artboards in this project yet.',
        state: { artboards: [] },
        success: true,
      };

    return {
      content: outcome.artboards
        .map(
          (a) => `- ${a.id} "${a.title}" · task ${a.taskId} · ${a.phase} · revision ${a.revision}`,
        )
        .join('\n'),
      state: { artboards: outcome.artboards },
      success: true,
    };
  }
}
