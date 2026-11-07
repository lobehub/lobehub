import { ArtboardIdentifier } from '@lobechat/builtin-tool-artboard';
import type { ToolAfterCallContext } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

const EMPTY_API_ENUM = {} as Record<string, string>;

// Never invoked: artboard tools run on the server. It exists so tool_end refreshes the board cache
// whether or not a card or board is mounted (Works page, fullscreen board).
class ArtboardHookExecutor extends BaseExecutor<typeof EMPTY_API_ENUM> {
  readonly identifier = ArtboardIdentifier;
  protected readonly apiEnum = EMPTY_API_ENUM;

  onAfterCall = async ({ apiName, result }: ToolAfterCallContext) => {
    const { onArtboardToolResult } = await import('@/features/Artboard/data/onArtboardToolResult');
    await onArtboardToolResult({ apiName, result });
  };
}

export const artboardHookExecutor = new ArtboardHookExecutor();
