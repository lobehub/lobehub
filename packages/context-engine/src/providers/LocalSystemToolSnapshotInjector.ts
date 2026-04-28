import type { LocalSystemToolSnapshot } from '@lobechat/types';
import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:LocalSystemToolSnapshotInjector');

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    LocalSystemToolSnapshotInjectorInjectedCount?: number;
  }
}

export interface LocalSystemToolSnapshotInjectorConfig {
  enabled?: boolean;
}

const createToolArguments = (snapshot: LocalSystemToolSnapshot): string =>
  JSON.stringify(snapshot.arguments);

const createAssistantToolMessage = (message: any, snapshot: LocalSystemToolSnapshot) => ({
  content: '',
  createdAt: message.createdAt,
  id: `${message.id}-${snapshot.snapshotId}-assistant`,
  role: 'assistant',
  tools: [
    {
      apiName: snapshot.apiName,
      arguments: createToolArguments(snapshot),
      id: snapshot.toolCallId,
      identifier: snapshot.identifier,
      type: 'builtin',
    },
  ],
  updatedAt: message.updatedAt,
});

const createToolResultMessage = (message: any, snapshot: LocalSystemToolSnapshot) => ({
  content: snapshot.content ?? '',
  createdAt: message.createdAt,
  id: `${message.id}-${snapshot.snapshotId}-tool`,
  plugin: {
    apiName: snapshot.apiName,
    arguments: createToolArguments(snapshot),
    id: snapshot.toolCallId,
    identifier: snapshot.identifier,
    type: 'builtin',
  },
  pluginError: snapshot.error,
  pluginState: snapshot.state,
  role: 'tool',
  tool_call_id: snapshot.toolCallId,
  updatedAt: message.updatedAt,
});

export class LocalSystemToolSnapshotInjector extends BaseProcessor {
  readonly name = 'LocalSystemToolSnapshotInjector';

  constructor(
    private config: LocalSystemToolSnapshotInjectorConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    if (!this.config.enabled) return this.markAsExecuted(clonedContext);

    let injectedCount = 0;
    const nextMessages: any[] = [];

    for (const message of clonedContext.messages) {
      nextMessages.push(message);

      if (message.role !== 'user') continue;

      const snapshots = message.metadata?.localSystemToolSnapshots as
        | LocalSystemToolSnapshot[]
        | undefined;

      if (!snapshots?.length) continue;

      for (const snapshot of snapshots) {
        nextMessages.push(createAssistantToolMessage(message, snapshot));
        nextMessages.push(createToolResultMessage(message, snapshot));
        injectedCount++;
      }
    }

    clonedContext.messages = nextMessages;

    if (injectedCount > 0) {
      clonedContext.metadata.LocalSystemToolSnapshotInjectorInjectedCount = injectedCount;
      log('Injected %d local-system tool snapshots', injectedCount);
    }

    return this.markAsExecuted(clonedContext);
  }
}
