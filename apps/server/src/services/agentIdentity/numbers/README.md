# Dedicated agent numbers

One agent, one paid number, bought from a carrier API in seconds. The free
shared Linq pool (user binding by sender) lives in the messenger, not here.

```
NumberProvider (twilio.ts / telnyx.ts)     carrier REST + webhook format only
        ▲
DedicatedNumberService (service.ts)        pool · allocation · 10DLC gate · quarantine · billing · caps
        ▲
createDedicatedNumberAccountProvider       plugs a carrier into the identity registry as a `phone`
(accountProvider.ts)                       provider named after it (`twilio`, `telnyx`)
```

## Lifecycle

| Inventory status | Meaning                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pooled`         | Bought ahead of demand in `AGENT_NUMBER_POOL_AREA_CODES`, webhook already pointed at us, tagged `pool`.                                                                |
| `assigned`       | Claimed for one agent (`FOR UPDATE SKIP LOCKED`), retagged `agent:<id>`, mirrored as an `agent_accounts` `phone` row. Pool empty ⇒ search + buy on demand.             |
| `quarantined`    | The account was revoked. The number stays held for `AGENT_NUMBER_QUARANTINE_DAYS` (30–60, default 45), answers "out of service" once per sender per day, wakes nobody. |
| `released`       | The cron returned it to the carrier after the quarantine ended. Terminal.                                                                                              |

`GET /api/agent/accounts/numbers/maintenance` (Bearer `CRON_SECRET`, `?tasks=pool,eligibility,fees,release`) runs the
scheduled half: pool top-up, 10DLC refresh, monthly fee, quarantine release.

## Voice

Twilio numbers get `VoiceUrl = <sms webhook>/voice`. An assigned number answers with a transcribed voicemail
(`<Record transcribe>`); Twilio posts the transcript back to the SMS webhook, so it enters the inbox and wakes the agent
exactly like a text (`Voicemail: …`, no SMS charge). A quarantined number answers "This number is no longer in service"
and records nothing. Voice is not 10DLC-gated. Telnyx voice (Call Control) is not wired yet; voice minutes and
transcription are not billed per agent yet.

## Graded capability

Receiving (SMS, OTP) works the moment the number exists. Outbound SMS opens only when the carrier reports the number
on an **approved** 10DLC campaign (`messagingEligibility`, Twilio Messaging Service `Compliance/Usa2p` / Telnyx
`10dlc/phone_number_campaigns`). Until then the account row carries `capabilities.send = false` and
`metadata.sendBlockedReason = 'messaging_campaign_not_approved'`; the identity tab and the agent's system context both
say so, and `AgentAccountService.send` refuses with `send_not_enabled`. Nothing assumes approval.

## Billing

Per agent, in `agent_number_charges` (idempotent on `external_id`): `number_monthly`, `sms_segment` (in and out),
`carrier_fee` (outbound). Each new row is mirrored to the business slot `recordAgentNumberCharge`; the payment gate is
`authorizeDedicatedNumber`, the budget gate `checkAgentNumberSpendAllowance` (OSS stubs allow everything). The OSS caps
still apply: `AGENT_NUMBER_MONTHLY_SPEND_LIMIT_USD` and `AGENT_NUMBER_DAILY_SEGMENT_LIMIT` per agent.

## Local sandbox

No real carrier account is needed to exercise the flow:
`bun apps/server/src/services/agentIdentity/numbers/sandbox/server.ts` serves the Twilio REST subset (same paths, form
bodies, error codes, `X-Twilio-Signature`) on `:4637`, plus `/_sandbox` (console), `/_sandbox/inbound` (signed inbound
SMS) and `/_sandbox/campaign` (flip 10DLC status). Point `TWILIO_API_BASE_URL` / `TWILIO_MESSAGING_API_BASE_URL` at it.

## Compliance (US A2P 10DLC) — not decided in code

Two routes, both unconfirmed; the code works with either because it only reads the carrier's verdict.

1. **Sole-proprietor brand per user.** The user's own identity is registered as a brand and verified by an OTP to the
   user's own mobile. Risks: low throughput and one campaign / one number per brand; needs US/Canada personal details
   (excludes most non-US users); we collect and submit user PII as the ISV; whether "my AI agent texting on my behalf"
   is an acceptable sole-prop use case is unknown.
2. **Platform campaign.** LobeHub registers one brand/campaign and attaches every agent number to it. Risks: thousands of
   numbers on one campaign sending on behalf of unrelated users may be read as snowshoeing or as an ISV that should
   register each customer; one suspension cuts outbound for every agent at once; recipient consent / STOP–HELP handling
   becomes the platform's obligation.

Open questions for legal / carrier: which route the carriers accept for agent-generated traffic; TCPA consent for
agent-initiated messages and who is the legal sender; per-campaign number limits; whether releasing to the carrier
after our quarantine also triggers carrier number aging; non-US users. iMessage blue-bubble lines are out of scope
(Linq and Sendblue both require a sales contract) — a later premium add-on.
