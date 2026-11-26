import type { ContactUserProfile } from '@lobechat/types';

export interface ShareOwnerContactCardProps {
  /** The shared Agent's creator, whose limit refused the reply. */
  owner: ContactUserProfile;
}

/** The creator's card a refused visitor can act on, to ask them for more. Cloud only. */
export default function ShareOwnerContactCard(_props: ShareOwnerContactCardProps) {
  return null;
}
