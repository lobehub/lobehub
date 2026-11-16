/**
 * What the workspace connector page's Private tab shows. Its rows only exist
 * once the connector list has loaded, so before that the tab is loading, or
 * shows the load's failure: never "no private connectors" for a list it has
 * not read.
 */
export type PrivateTabState = 'empty' | 'error' | 'list' | 'loading';

export const privateTabState = ({
  count,
  error,
  isConnectorsInit,
}: {
  /** Rows the tab lists: private connectors and private OAuth integrations. */
  count: number;
  /** The connector list load's failure, if it failed. */
  error?: unknown;
  isConnectorsInit: boolean;
}): PrivateTabState => {
  if (count > 0) return 'list';
  if (!isConnectorsInit) return error ? 'error' : 'loading';
  return 'empty';
};
