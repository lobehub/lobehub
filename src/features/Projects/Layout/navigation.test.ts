import { describe, expect, it } from 'vitest';

import {
  getProjectAcceptancePath,
  getProjectAgentPath,
  getProjectConversationPath,
  getProjectConversationStartPath,
  getProjectGoalsPath,
  getProjectLibraryPath,
  getProjectTasksPath,
} from './navigation';

describe('project workspace navigation', () => {
  it('builds routes for project agents and libraries', () => {
    expect(getProjectAgentPath('agt_1')).toBe('/agent/agt_1');
    expect(getProjectLibraryPath('prj_1', 'kb_1')).toBe('/project/prj_1/library/kb_1');
    expect(getProjectTasksPath('prj_1')).toBe('/project/prj_1/tasks');
    expect(getProjectGoalsPath('prj_1')).toBe('/project/prj_1/goals');
    expect(getProjectAcceptancePath('prj_1')).toBe('/project/prj_1/acceptance');
  });

  it('builds new and existing project conversation routes for the coordinator', () => {
    expect(getProjectConversationPath('agt_coordinator')).toBe('/agent/agt_coordinator');
    expect(getProjectConversationPath('agt_coordinator', 'tpc_1')).toBe(
      '/agent/agt_coordinator/tpc_1',
    );
    expect(getProjectConversationStartPath('agt_coordinator', 'Plan Q3 & ship')).toBe(
      '/agent/agt_coordinator?message=Plan%20Q3%20%26%20ship',
    );
  });
});
