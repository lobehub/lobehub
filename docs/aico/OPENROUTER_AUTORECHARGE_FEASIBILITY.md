# OpenRouter Auto-Recharge Feasibility Note (Aico)

**Date:** 2026-08-03  
**Scope:** feasibility only — do **not** implement card/crypto automation in this wave.

## Official Management API (confirmed)

From OpenRouter docs (`/api/v1/keys`):

- Create/update keys with `limit` (USD) and `limit_reset` (`daily` | `weekly` | `monthly` | `null`).
- Resets occur at **midnight UTC**; weeks are Monday–Sunday.
- Key list responses expose `usage`, `usage_daily/weekly/monthly`, `limit_remaining`.
- There is **no documented Management API endpoint for master account prepaid balance / credits** suitable for programmatic auto-recharge triggers.

## Provider-native automatic recharge

| Mechanism | Status | Notes |
|---|---|---|
| Official auto-recharge on OpenRouter account | **Unconfirmed / not exposed via Management API** | Operators should use OpenRouter Dashboard billing settings if the product UI offers auto-top-up. |
| Programmatic card charge via Management API | **Not available** in current key management docs | Do not store card PANs/CVV. |
| Virtual card automation | **Not recommended** | High fraud/compliance risk; violates “never store card details”. |
| Crypto recharge automation | **Not recommended** | Would require storing exchange/wallet secrets — forbidden. |

## Recommended ops model for soft launch

1. Monitor aggregate burn via Aico usage logs + `aico_master_monitor_state` (status `unknown` when balance unavailable — **never fabricate zero**).
2. Set low-credit thresholds and projected exhaustion alerts from observed burn rate.
3. Manual OpenRouter Dashboard runbook for prepaid top-ups.
4. Prefer any **official provider-native** auto-recharge toggle in the OpenRouter dashboard if/when available — keep credentials out of Aico.

## Security / accounting risks of custom automation

- PCI scope if cards are handled.
- Irreversible crypto loss / key theft.
- Split-brain between OR prepaid and Aico org wallets.
- Difficult dispute trails.

## Decision for this wave

Implement monitoring stubs + runbook only. Revisit when OpenRouter documents a credits/balance API or first-party auto-recharge webhook.
