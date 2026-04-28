'use client';

import type { ClaudeCodeTodoItem, TodoWriteArgs } from '@lobechat/builtin-tool-claude-code';

export interface CodexTodoListEntry {
  completed?: boolean;
  text?: string;
}

export interface CodexTodoListArgs {
  items?: CodexTodoListEntry[];
}

export type CodexFileChangeKind = 'added' | 'deleted' | 'modified' | 'renamed';

export interface CodexFileChangeEntry {
  kind?: string;
  linesAdded?: number;
  linesDeleted?: number;
  path?: string;
}

export interface CodexFileChangeArgs {
  changes?: CodexFileChangeEntry[];
}

export interface CodexFileChangeState {
  changes?: CodexFileChangeEntry[];
  linesAdded?: number;
  linesDeleted?: number;
}

export interface CodexFileChangeStats {
  byKind: Record<CodexFileChangeKind, number>;
  firstPath?: string;
  linesAdded: number;
  linesDeleted: number;
  total: number;
}

const normalizeTodoEntries = (args?: CodexTodoListArgs) =>
  (args?.items || [])
    .map((item) => ({
      completed: !!item.completed,
      text: typeof item.text === 'string' ? item.text.trim() : '',
    }))
    .filter((item) => item.text.length > 0);

export const toTodoWriteArgs = (args?: CodexTodoListArgs): TodoWriteArgs => {
  let assignedProcessing = false;

  const todos = normalizeTodoEntries(args).map((item): ClaudeCodeTodoItem => {
    if (item.completed) {
      return {
        activeForm: item.text,
        content: item.text,
        status: 'completed',
      };
    }

    if (!assignedProcessing) {
      assignedProcessing = true;
      return {
        activeForm: item.text,
        content: item.text,
        status: 'in_progress',
      };
    }

    return {
      activeForm: item.text,
      content: item.text,
      status: 'pending',
    };
  });

  return { todos };
};

export const getFileChangeKind = (kind?: string): CodexFileChangeKind => {
  switch (kind) {
    case 'add': {
      return 'added';
    }
    case 'delete':
    case 'remove': {
      return 'deleted';
    }
    case 'rename': {
      return 'renamed';
    }
    default: {
      return 'modified';
    }
  }
};

export const getFileChangeKindLabel = (kind: CodexFileChangeKind) => {
  switch (kind) {
    case 'added': {
      return 'Add';
    }
    case 'deleted': {
      return 'Delete';
    }
    case 'renamed': {
      return 'Rename';
    }
    default: {
      return 'Modify';
    }
  }
};

export const formatFileChangeLineStats = (linesAdded = 0, linesDeleted = 0) => {
  if (linesAdded === 0 && linesDeleted === 0) return '';
  return `+${linesAdded} -${linesDeleted}`;
};

export const getFileChangeData = (
  args?: CodexFileChangeArgs,
  pluginState?: CodexFileChangeState,
) => ({
  changes: pluginState?.changes?.length ? pluginState.changes : (args?.changes ?? []),
  linesAdded: pluginState?.linesAdded ?? 0,
  linesDeleted: pluginState?.linesDeleted ?? 0,
});

export const getFileChangeStats = (
  args?: CodexFileChangeArgs,
  pluginState?: CodexFileChangeState,
): CodexFileChangeStats => {
  const byKind = {
    added: 0,
    deleted: 0,
    modified: 0,
    renamed: 0,
  } satisfies Record<CodexFileChangeKind, number>;

  const data = getFileChangeData(args, pluginState);
  let firstPath: string | undefined;
  let total = 0;

  for (const change of data.changes) {
    if (!firstPath && change.path) firstPath = change.path;
    byKind[getFileChangeKind(change.kind)] += 1;
    total += 1;
  }

  return {
    byKind,
    firstPath,
    linesAdded: data.linesAdded,
    linesDeleted: data.linesDeleted,
    total,
  };
};
