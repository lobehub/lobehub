export { ErrorClassifier, type ErrorClassifierType } from './classifier';
export { isUserSideError, matchErrorPattern, type MatchInput, type MatchResult } from './match';
export { ERROR_PATTERNS, type ErrorPattern } from './patterns';
export {
  ERROR_CODE_SPECS,
  type ErrorCodeSpec,
  formatErrorRef,
  getErrorCodeSpec,
  parseErrorRef,
} from './specs';
export {
  CATEGORY_NUMERIC_PREFIX,
  type ErrorAttribution,
  type ErrorCategory,
  type ErrorSeverity,
} from './taxonomy';
