/**
 * A private agent's model / execution-environment policy is configured ahead of
 * sharing, so its labels say "when shared" — otherwise members are promised (or
 * denied) something the agent nobody else can see never delivers.
 */
export const getSelectionPolicyLabelKeys = (isPrivate: boolean) =>
  isPrivate
    ? ({
        fixed: 'settingAgent.selectionPolicy.membersCannotSwitchWhenShared',
        member: 'settingAgent.selectionPolicy.membersCanSwitchWhenShared',
      } as const)
    : ({
        fixed: 'settingAgent.selectionPolicy.membersCannotSwitch',
        member: 'settingAgent.selectionPolicy.membersCanSwitch',
      } as const);
