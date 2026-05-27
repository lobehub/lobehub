# Wati (WhatsApp) platform protocol

## Overview

LobeHub integrates with [Wati](https://www.wati.io/) as a WhatsApp Business API provider.
Customers message the connected WhatsApp number; Wati forwards inbound events via webhook;
LobeHub replies with the Wati `sendSessionMessage` REST API inside the 24-hour session window.

## Credentials

| Field           | Purpose                                                      |
| --------------- | ------------------------------------------------------------ |
| `apiBaseUrl`    | Wati API host (e.g. `https://live-mt-server.wati.io`)        |
| `tenantId`      | Tenant segment in API paths (`/{tenantId}/api/v1/...`)       |
| `bearerToken`   | `Authorization: Bearer` token from Wati API docs             |
| `webhookSecret` | Optional HMAC secret for inbound webhook verification        |
| `applicationId` | Business channel phone number (digits, country code, no `+`) |

## Webhook URL

`POST {appUrl}/api/agent/webhooks/wati/{applicationId}`

Configure this URL in the Wati dashboard under **Webhooks**, enable **Message Received**,
and optionally set the same secret as `webhookSecret`.

## Inbound filter

- `eventType === "message"`
- `owner === false` (customer message, not business echo)
- `channelPhoneNumber` matches `applicationId` when present

## Thread IDs

`wati:user:{waId}` — one DM thread per WhatsApp user (`waId`).

## Outbound

`POST /{tenantId}/api/v1/sendSessionMessage/{whatsappNumber}?messageText=...&channelPhoneNumber=...`

See `src/wati-api.json` (OpenAPI v1) for the full REST surface.
