import { lambdaClient } from '@/libs/trpc/client';

class LivekitService {
  createSession = () => lambdaClient.livekit.createSession.mutate();
  checkConnection = () => lambdaClient.livekit.checkConnection.mutate();
  endSession = (roomName: string) => lambdaClient.livekit.endSession.mutate({ roomName });
}

export const livekitService = new LivekitService();
