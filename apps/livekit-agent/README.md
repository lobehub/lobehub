# LobeHub Conversation worker

Conversation is a personal setting, shared across a user's agents. Open
`/settings/conversation` to save a LiveKit WebSocket URL, API key, and API secret.
Credentials use LobeHub's existing encrypted user key vault. Enable Conversation,
choose an enabled speech output model and optional voice, and save. Speech input
uses the user's existing **Service Model → Speech Recognition** selection. Both
speech providers use their normal LobeHub provider credentials.

The composer **Conversation** button opens a voice/video session. On Home it
creates a conversation with the selected agent. In a conversation, it reuses that
conversation. Unconfigured users are taken to Conversation settings.

## Local development

From the repository root:

```sh
bun run dev:livekit
```

Set the worker's registration environment in the root `.env`:

```dotenv
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

These are the bundled local server's development credentials. Register the worker:

```sh
pnpm --filter @lobechat/livekit-agent download-files
bun run dev:voice
```

Enter the same local server values in **Settings → Conversation**. Use
**Save and test connection** to validate server access. The test validates the
server credentials; the worker must also be registered for a conversation to work.
A cloud or other self-hosted server needs a worker registered with that server's
own URL/key/secret. Do not use the development credentials for public deployments.
LobeHub's existing SSRF policy governs server administration requests, including
whether private network addresses are allowed.

## Runtime

LiveKit supplies microphone transport, VAD, interruption, remote playback, and its
React media controls. The worker requests transcription and speech synthesis from
the authenticated browser over bounded, targeted LiveKit streams. The browser
uses LobeHub's normal ASR/TTS routes. Provider keys never enter room metadata or
worker jobs. Only speech audio/text crosses the speech bridge.

Recognized text runs through the mounted conversation's normal `sendMessage`
path. Its selected model/harness, tools, approval UI, cancellation and history
remain owned by LobeHub. The worker has no reasoning LLM. Closing or navigating
away disconnects media and cancels pending operations.

Video mode allows camera/screen sharing. A JPEG frame is attached to each spoken
turn if the selected agent accepts images, and is saved in history through the
normal upload path. This is per-turn visual context, not continuous video model
inference. Microphone-only mode receives no camera/screen publication grant.
