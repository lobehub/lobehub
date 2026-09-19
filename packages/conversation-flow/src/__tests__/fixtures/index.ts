import type { Message, ParseResult } from '../../types';

export { inputs } from './inputs';
export { outputs } from './outputs';

/**
 * Serialized parse result type
 */
export interface SerializedParseResult {
  contextTree: ParseResult['contextTree'];
  flatList: ParseResult['flatList'];
  messageMap: Record<string, Message>;
}
