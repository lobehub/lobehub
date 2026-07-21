export const getWorkspaceAgentSelectionPolicyLabelKeys = (isPrivate: boolean) =>
  isPrivate
    ? ({
        locked: 'settingAgent.selectionPolicy.membersCannotSwitchWhenShared',
        unlocked: 'settingAgent.selectionPolicy.membersCanSwitchWhenShared',
      } as const)
    : ({
        locked: 'settingAgent.selectionPolicy.membersCannotSwitch',
        unlocked: 'settingAgent.selectionPolicy.membersCanSwitch',
      } as const);
