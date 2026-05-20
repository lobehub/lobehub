import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import type { LobeToolManifest, ToolsGenerationResult } from '@lobechat/context-engine';
import { generateToolsFromManifest } from '@lobechat/context-engine';
import debug from 'debug';

type UniformToolArray = NonNullable<ToolsGenerationResult['tools']>;
type UniformTool = UniformToolArray[number];

const log = debug('lobe-mecha:tool-set-composer');

export interface ToolSetComposerContext {
  isPageEditorReady?: boolean;
  scope?: string;
}

export interface ToolSetComposerInput {
  context: ToolSetComposerContext;
  injectedManifests?: LobeToolManifest[];
  toolsDetailed: ToolsGenerationResult;
}

export interface ComposedToolSet {
  enabledManifests: LobeToolManifest[];
  enabledToolIds: string[];
  tools?: UniformTool[];
}

const mergeInjectedManifests = (
  base: ComposedToolSet,
  injectedManifests: LobeToolManifest[] | undefined,
): ComposedToolSet => {
  if (!injectedManifests?.length) return base;

  const existingIds = new Set(base.enabledToolIds);
  const newManifests = injectedManifests.filter((m) => !existingIds.has(m.identifier));
  if (newManifests.length === 0) return base;

  const newTools = newManifests.flatMap((m) => generateToolsFromManifest(m));
  const mergedTools = base.tools
    ? [...base.tools, ...newTools]
    : newTools.length > 0
      ? newTools
      : undefined;

  return {
    enabledManifests: [...base.enabledManifests, ...newManifests],
    enabledToolIds: [...base.enabledToolIds, ...newManifests.map((m) => m.identifier)],
    tools: mergedTools,
  };
};

// `scope` is bound to the topic, not the route: navigating away from the page
// editor keeps `scope === 'page'` on the same topic. Without this drop the LLM
// still sees page-agent tools and can call them against a stale editor ref.
const dropPageAgentIfEditorNotMounted = (
  set: ComposedToolSet,
  context: ToolSetComposerContext,
): ComposedToolSet => {
  if (context.scope !== 'page') return set;
  if (!set.enabledToolIds.includes(PageAgentIdentifier)) return set;
  if (context.isPageEditorReady) return set;

  log('dropping %s: editor not mounted', PageAgentIdentifier);

  const toolNamePrefix = `${PageAgentIdentifier}____`;
  const nextTools = set.tools?.filter((t) => !t.function?.name?.startsWith(toolNamePrefix));

  return {
    enabledManifests: set.enabledManifests.filter((m) => m.identifier !== PageAgentIdentifier),
    enabledToolIds: set.enabledToolIds.filter((id) => id !== PageAgentIdentifier),
    tools: nextTools && nextTools.length > 0 ? nextTools : undefined,
  };
};

export const composeEnabledTools = ({
  toolsDetailed,
  injectedManifests,
  context,
}: ToolSetComposerInput): ComposedToolSet => {
  const initial: ComposedToolSet = {
    enabledManifests: toolsDetailed.enabledManifests,
    enabledToolIds: toolsDetailed.enabledToolIds,
    tools: toolsDetailed.tools,
  };

  return dropPageAgentIfEditorNotMounted(
    mergeInjectedManifests(initial, injectedManifests),
    context,
  );
};
