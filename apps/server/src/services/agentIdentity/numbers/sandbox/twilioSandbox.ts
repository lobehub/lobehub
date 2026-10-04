import { computeTwilioSignature } from '../twilio';

/**
 * A Twilio REST sandbox: the subset of the 2010-04-01 + Messaging v1 API the
 * Twilio adapter calls, with the same paths, form bodies, JSON shapes, error
 * codes and webhook signature — so the adapter runs unmodified against it by
 * pointing `TWILIO_API_BASE_URL` / `TWILIO_MESSAGING_API_BASE_URL` here.
 *
 * It mirrors Twilio *test credential* semantics where they exist: buying
 * `+15005550000` fails with 21422 ("not available"), anything else succeeds and
 * nothing is billed. It never talks to Twilio. Used by the unit tests (as an
 * in-process `fetch`) and by local acceptance (behind an HTTP server, see
 * `server.ts`), where no real Twilio account may be opened or charged.
 */

export const TWILIO_UNAVAILABLE_MAGIC_NUMBER = '+15005550000';

export interface SandboxNumber {
  friendlyName: string;
  phoneNumber: string;
  released: boolean;
  sid: string;
  smsUrl: string;
  voiceUrl: string;
}

export interface SandboxMessage {
  body: string;
  from: string;
  numSegments: number;
  sid: string;
  to: string;
}

export interface TwilioSandboxState {
  /** Available inventory per area code (what AvailablePhoneNumbers returns). */
  available: Map<string, string[]>;
  /** Campaign status of the Messaging Service (`VERIFIED`, `PENDING`, …). */
  campaignStatus?: string;
  /** Every request the sandbox served, for evidence. */
  log: { method: string; path: string; status: number }[];
  messages: SandboxMessage[];
  /** Numbers attached to the Messaging Service (by `PN…` sid). */
  messagingServiceNumbers: Set<string>;
  numbers: Map<string, SandboxNumber>;
}

export interface TwilioSandboxOptions {
  accountSid: string;
  authToken: string;
  /** Area code → numbers the sandbox can "sell". */
  inventory?: Record<string, string[]>;
  messagingServiceSid?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

const twilioError = (status: number, code: number, message: string) =>
  json({ code, message, more_info: `https://www.twilio.com/docs/errors/${code}`, status }, status);

const segments = (text: string) => {
  // eslint-disable-next-line no-control-regex
  const gsm = /^[\u0000-\u007F]*$/.test(text);
  const length = [...text].length;
  if (gsm) return length <= 160 ? 1 : Math.ceil(length / 153);
  return length <= 70 ? 1 : Math.ceil(length / 67);
};

let counter = 0;
const sid = (prefix: string) =>
  `${prefix}${(Date.now().toString(16) + (++counter).toString(16)).padStart(32, '0').slice(-32)}`;

export const createTwilioSandbox = (options: TwilioSandboxOptions) => {
  const state: TwilioSandboxState = {
    available: new Map(Object.entries(options.inventory ?? {}).map(([k, v]) => [k, [...v]])),
    campaignStatus: options.messagingServiceSid ? 'PENDING' : undefined,
    log: [],
    messages: [],
    messagingServiceNumbers: new Set(),
    numbers: new Map(),
  };

  const expectedAuth = `Basic ${Buffer.from(`${options.accountSid}:${options.authToken}`).toString('base64')}`;
  const accountPrefix = `/2010-04-01/Accounts/${options.accountSid}`;

  const route = async (method: string, url: URL, body: string): Promise<Response> => {
    const form = Object.fromEntries(new URLSearchParams(body));
    const path = url.pathname;

    // --- Available numbers ---
    const available = path.match(
      new RegExp(`^${accountPrefix}/AvailablePhoneNumbers/(\\w+)/Local\\.json$`),
    );
    if (method === 'GET' && available) {
      const areaCode = url.searchParams.get('AreaCode') ?? '';
      const pageSize = Number(url.searchParams.get('PageSize') ?? 20);
      const candidates = areaCode
        ? (state.available.get(areaCode) ?? [])
        : [...state.available.values()].flat();
      return json({
        available_phone_numbers: candidates.slice(0, pageSize).map((phone) => ({
          capabilities: { MMS: true, SMS: true, voice: true },
          friendly_name: phone,
          iso_country: available[1],
          locality: 'Sandbox',
          phone_number: phone,
          region: 'CA',
        })),
        uri: path,
      });
    }

    // --- Buy ---
    if (method === 'POST' && path === `${accountPrefix}/IncomingPhoneNumbers.json`) {
      const phone = form.PhoneNumber;
      if (!phone) return twilioError(400, 21_421, 'PhoneNumber is required.');
      if (phone === TWILIO_UNAVAILABLE_MAGIC_NUMBER) {
        return twilioError(400, 21_422, 'Phone number is not available.');
      }
      for (const [area, list] of state.available) {
        state.available.set(
          area,
          list.filter((n) => n !== phone),
        );
      }
      const number: SandboxNumber = {
        friendlyName: form.FriendlyName ?? phone,
        phoneNumber: phone,
        released: false,
        sid: sid('PN'),
        smsUrl: form.SmsUrl ?? '',
        voiceUrl: form.VoiceUrl ?? '',
      };
      state.numbers.set(number.sid, number);
      return json(
        {
          account_sid: options.accountSid,
          friendly_name: number.friendlyName,
          phone_number: phone,
          sid: number.sid,
          sms_method: 'POST',
          sms_url: number.smsUrl,
        },
        201,
      );
    }

    // --- Update / release one number ---
    const one = path.match(new RegExp(`^${accountPrefix}/IncomingPhoneNumbers/(PN\\w+)\\.json$`));
    if (one) {
      const number = state.numbers.get(one[1]);
      if (!number || number.released) {
        return twilioError(404, 20_404, `The requested resource ${path} was not found`);
      }
      if (method === 'POST') {
        if (form.FriendlyName) number.friendlyName = form.FriendlyName;
        if (form.SmsUrl) number.smsUrl = form.SmsUrl;
        if (form.VoiceUrl) number.voiceUrl = form.VoiceUrl;
        return json({
          friendly_name: number.friendlyName,
          phone_number: number.phoneNumber,
          sid: number.sid,
          sms_url: number.smsUrl,
        });
      }
      if (method === 'DELETE') {
        number.released = true;
        state.messagingServiceNumbers.delete(number.sid);
        return new Response(null, { status: 204 });
      }
    }

    // --- Messages ---
    if (method === 'POST' && path === `${accountPrefix}/Messages.json`) {
      const from = [...state.numbers.values()].find(
        (n) => n.phoneNumber === form.From && !n.released,
      );
      if (!from)
        return twilioError(
          400,
          21_606,
          `The From phone number ${form.From} is not a valid, SMS-capable inbound phone number for your account.`,
        );
      const message: SandboxMessage = {
        body: form.Body ?? '',
        from: form.From,
        numSegments: segments(form.Body ?? ''),
        sid: sid('SM'),
        to: form.To,
      };
      state.messages.push(message);
      return json(
        {
          body: message.body,
          from: message.from,
          num_segments: String(message.numSegments),
          price: null,
          sid: message.sid,
          status: 'queued',
          to: message.to,
        },
        201,
      );
    }

    // --- Messaging Service (10DLC) ---
    if (options.messagingServiceSid) {
      const service = `/v1/Services/${options.messagingServiceSid}`;
      if (method === 'POST' && path === `${service}/PhoneNumbers`) {
        if (state.messagingServiceNumbers.has(form.PhoneNumberSid)) {
          return twilioError(409, 21_710, 'Phone Number is already in the Messaging Service.');
        }
        state.messagingServiceNumbers.add(form.PhoneNumberSid);
        return json({ sid: form.PhoneNumberSid }, 201);
      }
      const attached = path.match(new RegExp(`^${service}/PhoneNumbers/(PN\\w+)$`));
      if (method === 'GET' && attached) {
        return state.messagingServiceNumbers.has(attached[1])
          ? json({ sid: attached[1] })
          : twilioError(404, 20_404, 'Not found');
      }
      if (method === 'GET' && path === `${service}/Compliance/Usa2p`) {
        return json({
          compliance: [
            { campaign_status: state.campaignStatus, sid: 'QE2c6890da8086d771620e9b13fadeba0b' },
          ],
        });
      }
    }

    return twilioError(404, 20_404, `The requested resource ${path} was not found`);
  };

  /** Drop-in `fetch` for the Twilio adapter. */
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : '';

    const response =
      headers.get('authorization') === expectedAuth
        ? await route(method, url, body)
        : twilioError(401, 20_003, 'Authenticate');

    state.log.push({ method, path: url.pathname, status: response.status });
    return response;
  };

  /**
   * Build the inbound webhook Twilio would post when `from` texts `to`:
   * form body + `X-Twilio-Signature` over the number's configured SMS URL.
   */
  const buildInbound = (params: { body: string; from: string; to: string }) => {
    const number = [...state.numbers.values()].find(
      (n) => n.phoneNumber === params.to && !n.released,
    );
    if (!number) throw new Error(`Sandbox does not own ${params.to}`);

    const form: Record<string, string> = {
      AccountSid: options.accountSid,
      ApiVersion: '2010-04-01',
      Body: params.body,
      From: params.from,
      MessageSid: sid('SM'),
      NumMedia: '0',
      NumSegments: String(segments(params.body)),
      SmsMessageSid: '',
      SmsSid: '',
      SmsStatus: 'received',
      To: params.to,
    };
    form.SmsMessageSid = form.MessageSid;
    form.SmsSid = form.MessageSid;

    return {
      body: new URLSearchParams(form).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': computeTwilioSignature(options.authToken, number.smsUrl, form),
      },
      messageSid: form.MessageSid,
      url: number.smsUrl,
    };
  };

  const signed = (url: string, form: Record<string, string>) => ({
    body: new URLSearchParams(form).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': computeTwilioSignature(options.authToken, url, form),
    },
    url,
  });

  /** The voice webhook Twilio posts when `from` calls `to`. */
  const buildCall = (params: { from: string; to: string }) => {
    const number = [...state.numbers.values()].find(
      (n) => n.phoneNumber === params.to && !n.released,
    );
    if (!number) throw new Error(`Sandbox does not own ${params.to}`);
    const callSid = sid('CA');
    return {
      callSid,
      ...signed(number.voiceUrl, {
        AccountSid: options.accountSid,
        ApiVersion: '2010-04-01',
        CallSid: callSid,
        CallStatus: 'ringing',
        Direction: 'inbound',
        From: params.from,
        To: params.to,
      }),
    };
  };

  /** The transcription callback Twilio posts after a <Record transcribe> finishes. */
  const buildTranscription = (params: {
    callSid: string;
    callbackUrl: string;
    from: string;
    text: string;
    to: string;
  }) => {
    const recordingSid = sid('RE');
    return signed(params.callbackUrl, {
      AccountSid: options.accountSid,
      ApiVersion: '2010-04-01',
      CallSid: params.callSid,
      From: params.from,
      RecordingSid: recordingSid,
      RecordingUrl: `https://api.twilio.com/2010-04-01/Accounts/${options.accountSid}/Recordings/${recordingSid}`,
      To: params.to,
      TranscriptionSid: sid('TR'),
      TranscriptionStatus: 'completed',
      TranscriptionText: params.text,
    });
  };

  return { buildCall, buildInbound, buildTranscription, fetch: fetchImpl, route, state };
};

export type TwilioSandbox = ReturnType<typeof createTwilioSandbox>;
