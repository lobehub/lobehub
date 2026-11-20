import { getTrpcClient } from '../../api/client';

/**
 * Whether this process runs with a server-minted operation token (device and
 * gateway runs) rather than the user's own login. Operation tokens are refused
 * on ordinary routes, so commands that act for the running conversation pick
 * the operation-authenticated endpoint instead.
 */
export const hasOperationToken = () => {
  const injectedJwt = process.env.LOBEHUB_JWT;
  if (!injectedJwt) return false;
  try {
    return (
      JSON.parse(Buffer.from(injectedJwt.split('.')[1], 'base64url').toString()).purpose ===
      'hetero-operation'
    );
  } catch {
    return false;
  }
};

/**
 * The Goal reads `lh goal show` / `state` / `events` / `metric list` use,
 * picked by credential.
 *
 * A device or gateway planning run holds a `hetero-operation` JWT, and the
 * server's ordinary authed routes refuse that by design — so the same reads have
 * an operation-authenticated twin. Runs holding one are exactly the runs whose
 * refusal these commands exist to explain, so they must not be the ones that
 * cannot read.
 */
export const goalReads = async () => {
  const client = await getTrpcClient();
  return hasOperationToken()
    ? {
        events: client.goal.eventsOperation,
        graph: client.goal.graphOperation,
        metricState: client.goal.metricStateOperation,
        planContext: client.goal.planContextOperation,
      }
    : {
        events: client.goal.events,
        graph: client.goal.graph,
        metricState: client.goal.metricState,
        planContext: client.goal.planContext,
      };
};

export type GoalReads = Awaited<ReturnType<typeof goalReads>>;
