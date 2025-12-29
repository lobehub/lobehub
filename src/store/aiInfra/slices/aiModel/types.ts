export interface ModelUpdateResult {
  /** Models that were added */
  added: string[];
  /** Models that exist in model-bank builtin list but not in remote */
  builtinNotInRemote: string[];
  /** Models that were removed from remote but still exist in model-bank builtin list */
  removedButBuiltin: string[];
  /** Models that were actually removed */
  removedFromList: string[];
}
