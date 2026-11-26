import type {
  ChannelMemberActorType,
  ChannelMemberGrantStatus,
  ChannelMemberRole,
  ChannelMemberStatus,
} from './channel';

/** Where an Agent member runs in this Channel, readable by every member. */
export interface ChannelMemberEnvironmentPreview {
  deviceId: string | null;
  /** The device's friendly name, else its hostname; null when the device row is gone. */
  deviceName: string | null;
  /**
   * The device owner's approval for a private workspace device picked in this Channel;
   * absent when the device needs none (public, personal, or the Agent's own setting).
   */
  grant?: ChannelMemberDeviceGrant;
  workingDirectory: string | null;
}

/** One Agent member's grant on someone's private device, as members of the Channel see it. */
export interface ChannelMemberDeviceGrant {
  /** Who decides it; the client offers approve / reject / revoke to this person only. */
  deviceOwnerId: string;
  id: string;
  status: ChannelMemberGrantStatus;
}

export interface ChannelPublicMember {
  actorType: ChannelMemberActorType;
  agentId: string | null;
  avatar: string | null;
  /**
   * Agent members only: the viewer may open the Agent's own page. False for a workspace
   * colleague's private Agent, another scope's Agent, or one in the recycle bin.
   */
  canOpenAgent?: boolean;
  description: string | null;
  /** Agent members only; null when the Channel sets no device or directory for it. */
  environment?: ChannelMemberEnvironmentPreview | null;
  id: string;
  /** The member who added this one; null when they joined on their own or the adder is unknown. */
  invitedBy: string | null;
  joinedAt: Date;
  /** An Agent that answers only when @mentioned; see `ChannelMemberConfig.muted`. */
  muted?: boolean;
  name: string | null;
  role: ChannelMemberRole | null;
  status: ChannelMemberStatus;
  userAvatar: string | null;
  userId: string | null;
  userName: string | null;
  username: string | null;
}
