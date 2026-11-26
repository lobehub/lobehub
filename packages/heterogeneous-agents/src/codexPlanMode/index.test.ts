import { describe, expect, it } from 'vitest';

import {
  COLLABORATION_MODE_PHASE,
  collaborationModeReportPatch,
  isCollaborationModeReport,
} from '.';

describe('collaborationModeReportPatch', () => {
  it('writes nothing for a read-back that confirms the request', () => {
    // A user flip during the run must never be undone by the run's own report.
    expect(collaborationModeReportPatch({ collaborationMode: 'plan', requested: 'plan' })).toEqual(
      {},
    );
  });

  it('follows Codex where it disagrees with the request', () => {
    expect(
      collaborationModeReportPatch({ collaborationMode: 'default', requested: 'plan' }),
    ).toEqual({
      heteroPlanMode: false,
    });
  });
});

describe('isCollaborationModeReport', () => {
  it('accepts the phase with a known mode, and nothing else', () => {
    expect(isCollaborationModeReport({ phase: COLLABORATION_MODE_PHASE })).toBe(false);
    expect(
      isCollaborationModeReport({ collaborationMode: 'plan', phase: COLLABORATION_MODE_PHASE }),
    ).toBe(true);
    expect(
      isCollaborationModeReport({ collaborationMode: 'execute', phase: COLLABORATION_MODE_PHASE }),
    ).toBe(false);
    expect(isCollaborationModeReport({ phase: 'permission_mode' })).toBe(false);
  });
});
