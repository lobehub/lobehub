import { fileURLToPath } from 'node:url';

import { cli, defineAgent, ServerOptions, voice } from '@livekit/agents';
import * as silero from '@livekit/agents-plugin-silero';
import { VOICE_AGENT_NAME, voiceJobSchema } from '@lobechat/livekit-bridge';
import dotenv from 'dotenv';

import { LobeHubBridge } from './bridge.js';
import { LobeHubSTT, LobeHubTTS } from './speech.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

export default defineAgent({
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx) => {
    const { participantIdentity, config } = voiceJobSchema.parse(JSON.parse(ctx.job.metadata));
    const bridge = new LobeHubBridge(ctx.room, participantIdentity);
    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: new LobeHubSTT(bridge, config.language),
      tts: new LobeHubTTS(bridge),
      // No LLM is configured here. LobeHub owns all model/harness selection and tools.
      turnHandling: {
        turnDetection: 'vad',
        endpointing: { minDelay: config.silenceMs / 1000 },
      },
    });
    const agent = voice.Agent.create({
      instructions: 'Speech transport for the active LobeHub conversation.',
      llmNode: (_ctx, chatCtx) => {
        const message = chatCtx.items.findLast(
          (item) => item.type === 'message' && item.role === 'user',
        );
        if (!message || message.type !== 'message' || !message.textContent) return null;
        return bridge.run(message.textContent);
      },
    });
    ctx.addShutdownCallback(async () => {
      bridge.close();
      await session.close();
    });
    await ctx.connect();
    await session.start({
      agent,
      room: ctx.room,
      inputOptions: { participantIdentity },
      record: false,
    });
  },
});

cli.runApp(
  new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: VOICE_AGENT_NAME }),
);
