import { describe, expect, it } from 'vitest';

import {
  getProjectAcceptancePath,
  getProjectAgentPath,
  getProjectDashboardPath,
  getProjectGoalsPath,
  getProjectHomePath,
  getProjectLibraryPath,
  getProjectSettingsPath,
  getProjectTasksPath,
  getProjectTopicPath,
  isProjectSectionActive,
  toProjectPathname,
} from './navigation';

describe('project workspace navigation', () => {
  it('builds routes for project agents and libraries', () => {
    expect(getProjectAgentPath('agt_1')).toBe('/agent/agt_1');
    expect(getProjectLibraryPath('prj_1', 'kb_1')).toBe('/project/prj_1/library/kb_1');
    expect(getProjectHomePath('prj_1')).toBe('/project/prj_1');
    expect(getProjectTasksPath('prj_1')).toBe('/project/prj_1/tasks');
    expect(getProjectGoalsPath('prj_1')).toBe('/project/prj_1/goals');
    expect(getProjectAcceptancePath('prj_1')).toBe('/project/prj_1/acceptance');
    expect(getProjectSettingsPath('prj_1', 'members')).toBe('/project/prj_1/settings/members');
  });

  it('builds the project dashboard list and board routes', () => {
    expect(getProjectDashboardPath('prj_1')).toBe('/project/prj_1/dashboard');
    expect(getProjectDashboardPath('prj_1', 'd-1')).toBe('/project/prj_1/dashboard/d-1');
  });

  it('builds new and existing conversation routes inside the project', () => {
    expect(getProjectTopicPath('prj_1')).toBe('/project/prj_1/topic');
    expect(getProjectTopicPath('prj_1', 'tpc_1')).toBe('/project/prj_1/topic/tpc_1');
  });
});

describe('isProjectSectionActive', () => {
  /** @example Acceptance: opening a record un-highlighted the Acceptance nav item. */
  it('keeps a section active on its own record pages', () => {
    const section = getProjectAcceptancePath('prj_1');

    expect(isProjectSectionActive(section, section)).toBe(true);
    expect(isProjectSectionActive(`${section}/acc_1`, section)).toBe(true);
    expect(isProjectSectionActive(`${section}/acc_1/check/chk_1`, section)).toBe(true);
  });

  it('does not match a sibling path that only shares the prefix', () => {
    expect(
      isProjectSectionActive('/project/prj_1/acceptance-old', '/project/prj_1/acceptance'),
    ).toBe(false);
  });
});

describe('toProjectPathname', () => {
  it('drops the workspace slug so section paths compare equal', () => {
    expect(toProjectPathname('/acme/project/prj_1')).toBe('/project/prj_1');
    expect(toProjectPathname('/acme/project/prj_1/tasks')).toBe('/project/prj_1/tasks');
    expect(toProjectPathname('/project/prj_1/goals')).toBe('/project/prj_1/goals');
  });
});
