export { ErrorClassifier, type ErrorClassifierType } from './classifier';
export { isUserSideError, matchErrorPattern, type MatchInput, type MatchResult } from './match';
export { ERROR_PATTERNS, type ErrorPattern } from './patterns';
export { refineErrorCode, type RefineErrorInput } from './refine';
export {
  type CloudErrorCode,
  ERROR_CODE_SPECS,
  type ErrorCodeSpec,
  formatErrorRef,
  getErrorCodeSpec,
  parseErrorRef,
  type SpecErrorCode,
} from './specs';
export {
  CATEGORY_NUMERIC_PREFIX,
  CLOUD_TIER_DIGIT,
  type ErrorAttribution,
  type ErrorCategory,
  type ErrorSeverity,
} from './taxonomy';
