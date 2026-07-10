import type { GatewayQueuedMessage, RuntimeMentionedAgent } from '@lobechat/types';

export interface MergedGatewayQueuedMessage {
  appContext?: GatewayQueuedMessage['appContext'];
  consumedQueueIds: string[];
  deviceId?: string;
  editorData?: GatewayQueuedMessage['editorData'];
  fileIds: string[];
  filesPreview: NonNullable<GatewayQueuedMessage['filesPreview']>;
  mentionedAgents: RuntimeMentionedAgent[];
  metadata?: GatewayQueuedMessage['metadata'];
  prompt: string;
  selectedToolIds: string[];
  trigger?: GatewayQueuedMessage['trigger'];
  userInterventionConfig?: GatewayQueuedMessage['userInterventionConfig'];
}

const dedupeStrings = (values: string[]): string[] => [...new Set(values)];

const createTextNode = (text: string): Record<string, unknown> => ({
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text,
  type: 'text',
  version: 1,
});

const createParagraphNode = (text = ''): Record<string, unknown> => ({
  children: text ? [createTextNode(text)] : [],
  direction: 'ltr',
  format: '',
  indent: 0,
  type: 'paragraph',
  version: 1,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeEditorData = (
  message: GatewayQueuedMessage,
): Record<string, unknown> | undefined => {
  const root = message.editorData?.root;
  if (isRecord(root)) return message.editorData;
  if (!message.prompt) return undefined;

  return {
    root: {
      children: message.prompt.split('\n').map((line) => createParagraphNode(line)),
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  };
};

const mergeEditorData = (messages: GatewayQueuedMessage[]): Record<string, unknown> | undefined => {
  const mergedChildren: unknown[] = [];
  let baseRoot: Record<string, unknown> | undefined;

  for (const message of messages) {
    const root = normalizeEditorData(message)?.root;
    if (!isRecord(root) || !Array.isArray(root.children) || root.children.length === 0) continue;

    baseRoot ??= structuredClone(root);
    if (mergedChildren.length > 0) mergedChildren.push(createParagraphNode());
    mergedChildren.push(...structuredClone(root.children));
  }

  if (!baseRoot || mergedChildren.length === 0) return undefined;

  return {
    root: {
      ...baseRoot,
      children: mergedChildren,
      type: 'root',
      version: baseRoot.version ?? 1,
    },
  };
};

const mergeMetadata = (messages: GatewayQueuedMessage[]): GatewayQueuedMessage['metadata'] =>
  messages.reduce<GatewayQueuedMessage['metadata']>((accumulator, message) => {
    if (!message.metadata) return accumulator;

    const contextSelections = [
      ...(accumulator?.contextSelections ?? []),
      ...(message.metadata.contextSelections ?? []),
    ];
    const localSystemToolSnapshots = [
      ...(accumulator?.localSystemToolSnapshots ?? []),
      ...(message.metadata.localSystemToolSnapshots ?? []),
    ];
    const pageSelections = [
      ...(accumulator?.pageSelections ?? []),
      ...(message.metadata.pageSelections ?? []),
    ];

    return {
      ...accumulator,
      ...message.metadata,
      ...(contextSelections.length > 0 && { contextSelections }),
      ...(localSystemToolSnapshots.length > 0 && { localSystemToolSnapshots }),
      ...(pageSelections.length > 0 && { pageSelections }),
    };
  }, undefined);

const lastDefined = <K extends keyof GatewayQueuedMessage>(
  messages: GatewayQueuedMessage[],
  key: K,
): GatewayQueuedMessage[K] | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const value = messages[index][key];
    if (value !== undefined) return value;
  }

  return undefined;
};

/** Merge a handoff snapshot into the replay payload for the next Gateway operation. */
export const mergeGatewayQueuedMessages = (
  messages: GatewayQueuedMessage[],
): MergedGatewayQueuedMessage | null => {
  if (messages.length === 0) return null;

  const sorted = [...messages].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
  const mentionedAgentMap = new Map<string, RuntimeMentionedAgent>();
  const filePreviewMap = new Map<
    string,
    NonNullable<GatewayQueuedMessage['filesPreview']>[number]
  >();

  for (const message of sorted) {
    for (const agent of message.mentionedAgents ?? []) mentionedAgentMap.set(agent.id, agent);
    for (const file of message.filesPreview ?? []) filePreviewMap.set(file.id, file);
  }

  return {
    appContext: lastDefined(sorted, 'appContext'),
    consumedQueueIds: sorted.map((message) => message.id),
    deviceId: lastDefined(sorted, 'deviceId'),
    editorData: mergeEditorData(sorted),
    fileIds: dedupeStrings(sorted.flatMap((message) => message.fileIds ?? [])),
    filesPreview: [...filePreviewMap.values()],
    mentionedAgents: [...mentionedAgentMap.values()],
    metadata: mergeMetadata(sorted),
    prompt: sorted.map((message) => message.prompt).join('\n\n'),
    selectedToolIds: dedupeStrings(sorted.flatMap((message) => message.selectedToolIds ?? [])),
    trigger: lastDefined(sorted, 'trigger'),
    userInterventionConfig: lastDefined(sorted, 'userInterventionConfig'),
  };
};
