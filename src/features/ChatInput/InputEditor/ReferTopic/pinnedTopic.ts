'use client';

import { createContext, use } from 'react';

/**
 * The topic a conversation surface is bound to. Inside such a surface (a goal's
 * supervision record) switching the shared active topic would replace that
 * conversation in place, so a topic reference opens beside it instead.
 */
export const PinnedTopicContext = createContext<string | undefined>(undefined);

export const usePinnedTopic = () => use(PinnedTopicContext);
