---
name: response-compliance
description: OpenResponses API compliance testing. Use when testing the Response API endpoint, running compliance tests, or debugging Response API schema issues. Triggers on 'compliance', 'response api test', 'openresponses test'.
---

# OpenResponses Compliance Test

Run the official OpenResponses compliance test suite against the local (or remote) Response API endpoint.

## Quick Start

```bash
# From the openapi package directory
cd lobehub/packages/openapi

# Run all tests (dev mode, localhost:3010)
APP_URL=http://localhost:3010 bun run test:response-compliance -- \
  --auth-header "lobe-auth-dev-backend-api" --no-bearer --api-key 1

# Run specific tests only
APP_URL=http://localhost:3010 bun run test:response-compliance -- \
  --auth-header "lobe-auth-dev-backend-api" --no-bearer --api-key 1 \
  --filter basic-response,streaming-response

# Verbose mode (shows request/response details)
APP_URL=http://localhost:3010 bun run test:response-compliance -- \
  --auth-header "lobe-auth-dev-backend-api" --no-bearer --api-key 1 -v

# JSON output (for CI)
APP_URL=http://localhost:3010 bun run test:response-compliance -- \
  --auth-header "lobe-auth-dev-backend-api" --no-bearer --api-key 1 --json
```

## Prerequisites

- Dev server running with `ENABLE_MOCK_DEV_USER=true` in `.env`
- The `api/v1/responses` route registered (via `src/app/(backend)/api/v1/[[...route]]/route.ts`)

## Auth Modes

| Mode            | Flags                                                               |
| --------------- | ------------------------------------------------------------------- |
| Dev (mock user) | `--auth-header "lobe-auth-dev-backend-api" --no-bearer --api-key 1` |
| API Key         | `--api-key lb-xxxxxxxxxxxxxxxx`                                     |
| Custom          | `--auth-header <name> --api-key <value>`                            |

## Test IDs

Available `--filter` values:

| ID                   | Description                            | Related Issue |
| -------------------- | -------------------------------------- | ------------- |
| `basic-response`     | Simple text generation (non-streaming) | LOBE-5858     |
| `streaming-response` | SSE streaming lifecycle + events       | LOBE-5859     |
| `system-prompt`      | System role message handling           | LOBE-5858     |
| `tool-calling`       | Function tool definition + call output | LOBE-5860     |
| `image-input`        | Multimodal image URL content           | —             |
| `multi-turn`         | Conversation history via input items   | LOBE-5861     |

## Environment Variables

| Variable  | Default                 | Description                               |
| --------- | ----------------------- | ----------------------------------------- |
| `APP_URL` | `http://localhost:3010` | Server base URL (auto-appends `/api/v1`)  |
| `API_KEY` | —                       | API key (alternative to `--api-key` flag) |

## How It Works

The script (`lobehub/packages/openapi/scripts/compliance-test.sh`) clones the official [openresponses/openresponses](https://github.com/openresponses/openresponses) repo into `scripts/openresponses-compliance/` (gitignored) and runs its CLI test runner. First run clones; subsequent runs update from upstream.

## Debugging Failures

1. Run with `-v` to see full request/response payloads
2. Common failure patterns:
   - **"Failed to parse JSON"**: Auth failed, server returned HTML redirect
   - **"Response has no output items"**: LLM execution not yet implemented
   - **"Expected number, received null"**: Missing required field in response schema
   - **"Invalid input"**: Zod validation on response schema — check field format

## Key Files

- **Types**: `lobehub/packages/openapi/src/types/responses.type.ts`
- **Service**: `lobehub/packages/openapi/src/services/responses.service.ts`
- **Controller**: `lobehub/packages/openapi/src/controllers/responses.controller.ts`
- **Route**: `lobehub/packages/openapi/src/routes/responses.route.ts`
- **Test script**: `lobehub/packages/openapi/scripts/compliance-test.sh`
- **Cloud route**: `src/app/(backend)/api/v1/[[...route]]/route.ts`
