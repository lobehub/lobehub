/** LOBEHUB_AGENT_ID=agt_... bun examples/streaming.ts "your prompt" — stream a response. */
/* eslint-disable no-console -- examples print their results */
import { lobehub } from './client';

const model = process.env.LOBEHUB_AGENT_ID;
if (!model) throw new Error('Set LOBEHUB_AGENT_ID to the agent that should answer');

const stream = lobehub().responses.stream({
  input: process.argv[2] ?? 'Say hello in one sentence.',
  model,
});

for await (const event of stream) {
  switch (event.type) {
    case 'response.output_text.delta': {
      process.stdout.write(event.delta);
      break;
    }
    case 'response.completed': {
      console.log(`\n\n${event.response.usage.total_tokens} tokens`);
      break;
    }
    case 'response.failed': {
      console.error('\nfailed:', event.response.error?.message);
      break;
    }
  }
}
