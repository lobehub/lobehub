import { type ReplicaSyncResult } from '@/libs/replica';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { initialState, type LinkPreviewState } from './initialState';
import { LinkPreviewPrivateAction } from './privateAction';
import { type LinkPreviewParams } from './projection';
import { useLinkPreviewStore } from './store';

const n = setNamespace('linkPreview');

type Setter = StoreSetter<LinkPreviewState>;

/**
 * A Channel can link the same page in many messages, and polling re-renders
 * every one of them: collapse their syncs into one request per page.
 */
const LINK_PREVIEW_DEDUPING_INTERVAL = 60_000;

export class LinkPreviewActionImpl {
  readonly #private: LinkPreviewPrivateAction;
  readonly #set: Setter;

  constructor(set: Setter, _get: () => LinkPreviewState, privateAction: LinkPreviewPrivateAction) {
    this.#set = set;
    this.#private = privateAction;
  }

  /**
   * Fetch orchestration for one linked page's card. Read it with
   * `linkPreviewSelectors.getPreview`, not from the return value.
   */
  useFetchLinkPreview = (params: LinkPreviewParams | null): ReplicaSyncResult =>
    this.#private.previews.useSync(params, {
      dedupingInterval: LINK_PREVIEW_DEDUPING_INTERVAL,
      enabled: !!params,
      revalidateOnFocus: false,
    });

  reset = (): void => {
    this.#set(initialState, false, n('reset'));
  };
}

const { getState, setState } = useLinkPreviewStore;

export const linkPreviewActions = new LinkPreviewActionImpl(
  setState,
  getState,
  new LinkPreviewPrivateAction(setState, getState),
);
