/**
 * Browser-safe slice of the Claude Code permission protocol: the card payload,
 * its option ids and the mode report. The responder and spawn args stay in
 * `./index` (Node only).
 */
export {
  isPermissionModeReport,
  PERMISSION_MODE_PHASE,
  type PermissionModeReportData,
  permissionModeReportPatch,
} from './modeReport';
export {
  CLAUDE_CODE_PERMISSION_NOTE_KEY,
  CLAUDE_CODE_PERMISSION_OPTION,
  type ClaudeCodePermissionDetail,
  type ClaudeCodePermissionInterventionArgs,
  type ClaudeCodePermissionKind,
  type ClaudeCodePermissionOptionId,
} from './request';
