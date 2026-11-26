/**
 * Whether an Agent can take work right now, as the dispatch layer sees it:
 *
 * - `offline`: it runs on a device that is not connected, so nothing reaches it;
 * - `sleeping`: its managed cloud device is asleep; a message wakes it, so it
 *   still takes work, only the first reply is slower;
 * - `waking`: its managed cloud device is starting up;
 * - `offDuty`: every account it can run on has used up its quota;
 * - `working`: it has a Channel reply queued or running;
 * - `idle`: its device is connected and nothing is running;
 * - `online`: a cloud Agent with nothing running — it needs no device to answer.
 *
 * Checked in that order: a device that is not connected hides everything else, and an Agent
 * out of quota reads off duty even while a run already in flight finishes.
 */
export type AgentAvailabilityStatus =
  'idle' | 'offDuty' | 'offline' | 'online' | 'sleeping' | 'waking' | 'working';

export interface AgentAvailability {
  /** Channel replies the Agent has queued or running, across every Channel. */
  activeJobs: number;
  /** Whether an unaddressed message may be routed to it, per the deployment's dispatch policy. */
  dispatchable: boolean;
  /** When an off-duty Agent's quota comes back (ms), if every account says so. */
  resetsAt?: number;
  status: AgentAvailabilityStatus;
}
