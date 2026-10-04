/**
 * Local Twilio sandbox server for acceptance runs.
 *
 *   bun apps/server/src/services/agentIdentity/numbers/sandbox/server.ts   (or tsx)
 *
 * Point the app at it with:
 *
 *   TWILIO_API_BASE_URL=http://localhost:4637
 *   TWILIO_MESSAGING_API_BASE_URL=http://localhost:4637
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_MESSAGING_SERVICE_SID = the values below
 *
 * It serves the Twilio REST subset the adapter uses (see `twilioSandbox.ts`) and
 * a few control endpoints a tester drives:
 *
 * - `GET  /_sandbox`            — console page (numbers, messages, request log)
 * - `GET  /_sandbox/state`      — the same as JSON
 * - `POST /_sandbox/campaign`   — `{ "status": "VERIFIED" }` flips the 10DLC campaign
 * - `POST /_sandbox/call`       — `{ "from", "to", "speech" }` calls a sandbox number and,
 *   when the app answers with a transcribed voicemail, posts the transcription back.
 * - `POST /_sandbox/inbound`    — `{ "from", "to", "body" }` texts a sandbox number:
 *   the sandbox signs the webhook exactly like Twilio and posts it to the
 *   number's configured SmsUrl, then reports what the app answered.
 *
 * Nothing here reaches Twilio; no real number is bought or billed.
 */
import { createServer } from 'node:http';

import { createTwilioSandbox } from './twilioSandbox';

const PORT = Number(process.env.TWILIO_SANDBOX_PORT ?? 4637);
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? 'AC0000000000000000000000000000a637';
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? 'sandbox_auth_token_t637';
const SERVICE_SID =
  process.env.TWILIO_MESSAGING_SERVICE_SID ?? 'MG0000000000000000000000000000a637';

const sandbox = createTwilioSandbox({
  accountSid: ACCOUNT_SID,
  authToken: AUTH_TOKEN,
  inventory: {
    '212': ['+12125550141', '+12125550142'],
    '415': ['+14155550101', '+14155550102', '+14155550103', '+14155550104'],
  },
  messagingServiceSid: SERVICE_SID,
});

/** Inbound deliveries the sandbox posted, with what the app answered. */
const deliveries: {
  at: string;
  body: string;
  from: string;
  outcome: string | null;
  status: number;
  to: string;
  wake: string | null;
}[] = [];

const snapshot = () => ({
  account: ACCOUNT_SID,
  campaignStatus: sandbox.state.campaignStatus,
  deliveries,
  log: sandbox.state.log,
  messages: sandbox.state.messages,
  messagingServiceNumbers: [...sandbox.state.messagingServiceNumbers],
  numbers: [...sandbox.state.numbers.values()],
});

const escape = (value: unknown) =>
  String(value ?? '').replaceAll(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const table = (headers: string[], rows: unknown[][]) =>
  `<table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${
    rows.length === 0
      ? `<tr><td colspan="${headers.length}" class="empty">—</td></tr>`
      : rows.map((r) => `<tr>${r.map((c) => `<td>${escape(c)}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;

const consolePage = () => {
  const s = snapshot();
  return `<!doctype html><html><head><meta charset="utf-8"><title>Twilio sandbox</title>
<style>body{font:13px/1.5 -apple-system,system-ui,sans-serif;margin:24px;color:#111}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px}
.sub{color:#666;margin-bottom:12px}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #e5e5e5;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#fafafa}td.empty{color:#999;text-align:center}code{background:#f4f4f4;padding:0 4px}</style></head>
<body><h1>Twilio REST sandbox (local, no real carrier)</h1>
<div class="sub">Account <code>${escape(s.account)}</code> · 10DLC campaign status <code>${escape(s.campaignStatus)}</code> · Messaging Service numbers: ${escape(s.messagingServiceNumbers.join(', ') || '—')}</div>
<h2>Incoming phone numbers (bought through the API)</h2>
${table(
  ['Number', 'SID', 'FriendlyName (tag)', 'SmsUrl', 'VoiceUrl', 'Released'],
  s.numbers.map((n) => [
    n.phoneNumber,
    n.sid,
    n.friendlyName,
    n.smsUrl,
    n.voiceUrl,
    n.released ? 'yes (DELETE)' : 'no',
  ]),
)}
<h2>Inbound SMS / calls posted to the app (signed X-Twilio-Signature)</h2>
${table(
  ['At', 'From', 'To', 'Body', 'HTTP', 'X-Lobehub-Outcome', 'X-Lobehub-Wake'],
  s.deliveries.map((d) => [d.at, d.from, d.to, d.body, d.status, d.outcome, d.wake]),
)}
<h2>Outbound messages (POST Messages.json)</h2>
${table(
  ['SID', 'From', 'To', 'Segments', 'Body'],
  s.messages.map((m) => [m.sid, m.from, m.to, m.numSegments, m.body]),
)}
<h2>REST request log</h2>
${table(
  ['#', 'Method', 'Path', 'Status'],
  s.log.map((l, i) => [i + 1, l.method, l.path, l.status]),
)}
</body></html>`;
};

const handle = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname === '/_sandbox') {
    return new Response(consolePage(), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  if (url.pathname === '/_sandbox/state') return Response.json(snapshot());

  if (url.pathname === '/_sandbox/campaign' && request.method === 'POST') {
    const { status } = (await request.json()) as { status: string };
    sandbox.state.campaignStatus = status;
    return Response.json({ campaignStatus: status });
  }

  if (url.pathname === '/_sandbox/inbound' && request.method === 'POST') {
    const params = (await request.json()) as { body: string; from: string; to: string };
    const delivery = sandbox.buildInbound(params);
    const response = await fetch(delivery.url, {
      body: delivery.body,
      headers: delivery.headers,
      method: 'POST',
    });
    const record = {
      at: new Date().toISOString(),
      ...params,
      outcome: response.headers.get('x-lobehub-outcome'),
      status: response.status,
      wake: response.headers.get('x-lobehub-wake'),
    };
    deliveries.push(record);
    return Response.json({
      ...record,
      messageSid: delivery.messageSid,
      responseBody: await response.text(),
      webhookUrl: delivery.url,
    });
  }

  if (url.pathname === '/_sandbox/call' && request.method === 'POST') {
    // `from` calls `to` and, if the app answers with a transcribed <Record>,
    // says `speech` into the voicemail.
    const params = (await request.json()) as { from: string; speech: string; to: string };
    const call = sandbox.buildCall(params);
    const answer = await fetch(call.url, {
      body: call.body,
      headers: call.headers,
      method: 'POST',
    });
    const twiml = await answer.text();
    const record = {
      at: new Date().toISOString(),
      body: `[call] ${twiml.includes('<Record') ? `voicemail: ${params.speech}` : twiml.replaceAll(/<[^>]+>/g, ' ').trim()}`,
      from: params.from,
      outcome: answer.headers.get('x-lobehub-outcome'),
      status: answer.status,
      to: params.to,
      wake: null as string | null,
    };

    const callbackUrl = twiml.match(/transcribeCallback="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
    let transcription: unknown;
    if (callbackUrl) {
      const delivery = sandbox.buildTranscription({
        callSid: call.callSid,
        callbackUrl,
        from: params.from,
        text: params.speech,
        to: params.to,
      });
      const response = await fetch(delivery.url, {
        body: delivery.body,
        headers: delivery.headers,
        method: 'POST',
      });
      record.wake = response.headers.get('x-lobehub-wake');
      record.outcome = `${record.outcome} → transcript ${response.headers.get('x-lobehub-outcome')}`;
      transcription = { status: response.status, url: delivery.url };
    }
    deliveries.push(record);
    return Response.json({ ...record, transcription, twiml, voiceUrl: call.url });
  }

  // Everything else is the Twilio REST surface.
  return sandbox.fetch(url.toString(), {
    body:
      request.method === 'GET' || request.method === 'DELETE' ? undefined : await request.text(),
    headers: request.headers,
    method: request.method,
  });
};

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
  }

  const response = await handle(
    new Request(`http://localhost:${PORT}${req.url ?? '/'}`, {
      body: req.method === 'GET' || req.method === 'HEAD' || body.length === 0 ? undefined : body,
      headers,
      method: req.method,
    }),
  );

  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => {
  console.info(`[twilio-sandbox] listening on http://localhost:${PORT} (account ${ACCOUNT_SID})`);
});
