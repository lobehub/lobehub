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

  it('builds new and existing conversation routes inside the project', () => {
    expect(getProjectConversationPath('prj_1')).toBe('/project/prj_1/conversation');
    expect(getProjectConversationPath('prj_1', 'tpc_1')).toBe('/project/prj_1/conversation/tpc_1');
    expect(getProjectConversationStartPath('prj_1', 'Plan Q3 & ship')).toBe(
      '/project/prj_1/conversation?message=Plan%20Q3%20%26%20ship',
    );
  });
});
