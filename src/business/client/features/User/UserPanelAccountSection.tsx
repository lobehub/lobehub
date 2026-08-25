export interface UserPanelAccountSectionProps {
  /** Called right before navigating away, so the host popover can close itself. */
  onNavigate?: () => void;
}

/**
 * Bottom slot of the user panel, below the sign-out menu. The community build
 * has no secondary account surface to link to, so it renders nothing.
 */
const UserPanelAccountSection = (_props: UserPanelAccountSectionProps) => null;

export default UserPanelAccountSection;
