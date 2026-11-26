import { createContext, useContext } from 'react';

/**
 * Whether the surrounding list already lays a compressed group's original
 * conversation out as transcript rows above the group (the default chat list
 * does). The group then only marks the compression point and offers the
 * summary; lists with a custom item renderer keep the group's own history tab.
 */
export const CompressedHistoryInlineContext = createContext(false);

export const useCompressedHistoryInline = () => useContext(CompressedHistoryInlineContext);
