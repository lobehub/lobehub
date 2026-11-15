import { SignJWT } from 'jose';

/** Matches the LiveKit Agents inference grant, without importing its RTC worker SDK. */
export const createLiveKitInferenceToken = async (apiKey: string, apiSecret: string) =>
  new SignJWT({ inference: { perform: true } })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(apiKey)
    .setSubject('agent')
    .setNotBefore(0)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
    .sign(new TextEncoder().encode(apiSecret));

export const LIVEKIT_INFERENCE_BASE_URL = 'https://agent-gateway.livekit.cloud/v1';
