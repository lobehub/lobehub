import { TraceEventType } from '@lobechat/types';
import { after } from 'next/server';

import { flushTraces, getLangfuseClient } from '@/libs/traces';
import { TraceEventClient } from '@/libs/traces/event';
import { type TraceEventBasePayload, type TraceEventPayloads } from '@/types/trace';

export const POST = async (req: Request) => {
  type RequestData = TraceEventPayloads & TraceEventBasePayload;
  const data = (await req.json()) as RequestData;
  const { eventType } = data;

  const client = getLangfuseClient();
  const eventClient = client ? new TraceEventClient(client) : undefined;

  switch (eventType) {
    case TraceEventType.ModifyMessage: {
      await eventClient?.modifyMessage(data);
      break;
    }

    case TraceEventType.DeleteAndRegenerateMessage: {
      await eventClient?.deleteAndRegenerateMessage(data);
      break;
    }

    case TraceEventType.RegenerateMessage: {
      await eventClient?.regenerateMessage(data);
      break;
    }

    case TraceEventType.CopyMessage: {
      await eventClient?.copyMessage(data);
      break;
    }
  }

  after(async () => {
    await flushTraces();
  });

  return new Response(undefined, { status: 201 });
};
