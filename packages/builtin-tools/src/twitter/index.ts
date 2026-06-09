import { TwitterInspector } from '@lobechat/shared-tool-ui/inspectors';
import type { BuiltinInspector } from '@lobechat/types';

// LobeHub X (Twitter) skill: tool calls arrive with `identifier='twitter'`
// and bare verb_noun apiNames (`get_tweet`, `get_user`, `post_tweet`,
// `search_tweets`, …). The MCP surface isn't fixed in this repo, so we
// register the inspector through a Proxy that returns it for any apiName
// under the twitter identifier — the inspector's verb_noun parser handles
// labels generically and falls back gracefully on unknown verbs.
export const TwitterIdentifier = 'twitter';

export const TwitterInspectors: Record<string, BuiltinInspector> = new Proxy(
  {} as Record<string, BuiltinInspector>,
  {
    get: (_target, prop) => {
      if (typeof prop !== 'string') return undefined;
      return TwitterInspector;
    },
  },
);
