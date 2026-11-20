import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type OAuthAppItem } from '@/types/oauthApp';

export interface OAuthAppState {
  /** Apps by id. Replica view of `appDetailReplica`. */
  appDetailMap: Record<string, OAuthAppItem>;
  /** Replica bookkeeping for `appDetailMap`. */
  appDetailReplica: ReplicaState<OAuthAppItem>;
  /** The app list under the `all` key. Replica view of `appListReplica`. */
  appListMap: Record<string, OAuthAppItem[]>;
  /** Replica bookkeeping for `appListMap`. */
  appListReplica: ReplicaState<OAuthAppItem[]>;
  /** Ids the server settled as gone or not visible; the page goes back to the list. */
  appNotFoundMap: Record<string, boolean>;
}

export const initialOAuthAppState: OAuthAppState = {
  appDetailMap: {},
  appDetailReplica: createReplicaState(),
  appListMap: {},
  appListReplica: createReplicaState(),
  appNotFoundMap: {},
};
