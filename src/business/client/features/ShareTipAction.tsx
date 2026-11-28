export interface ShareTipActionProps {
  /** The shared Agent whose funds for visitor replies ran out. */
  agentId: string;
}

/**
 * What a visitor can do when a shared Agent's funds for visitor replies ran out, shown under
 * that refusal. Nothing by default: a deployment that lets visitors tip a share provides it.
 */
export default function ShareTipAction(_props: ShareTipActionProps) {
  return null;
}
