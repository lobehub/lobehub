import { CURRENT_VERSION } from '@lobechat/const';
import { Langfuse } from 'langfuse';
import { type CreateLangfuseTraceBody } from 'langfuse-core';

import { getLangfuseConfig } from '@/envs/langfuse';
import { TraceEventClient } from '@/libs/traces/event';

/**
 * We use langfuse as the tracing system to trace the request and response
 */
export class TraceClient {
  private _client?: Langfuse;

  constructor() {
    const { ENABLE_LANGFUSE, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST } =
      getLangfuseConfig();

    if (!ENABLE_LANGFUSE) return;

    // when enabled langfuse, make sure the key are ready in envs
    if (!LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) {
      console.log('-----');
      console.error(
        "You are enabling langfuse but don't set the `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY`. Please check your env",
      );

      throw new TypeError('NO_LANGFUSE_KEY_ERROR');
    }

    this._client = new Langfuse({
      baseUrl: LANGFUSE_HOST,
      publicKey: LANGFUSE_PUBLIC_KEY,
      release: CURRENT_VERSION,
      secretKey: LANGFUSE_SECRET_KEY,
    });
  }

  createEvent(traceId: string) {
    const trace = this.createTrace({ id: traceId });
    if (!trace) return;

    return new TraceEventClient(trace);
  }

  createTrace(param: CreateLangfuseTraceBody) {
    return this._client?.trace({ ...param });
  }

  async shutdownAsync() {
    await this._client?.shutdownAsync();
  }
}
