# Desktop provider import protocol

LobeHub Desktop can import an OpenAI-compatible provider and its chat models from another local
application. The API key is never placed in the custom-protocol URL. Instead, the importing
application exposes a short-lived, one-shot HTTP callback on a literal loopback address.

## Start an import

1. Bind an HTTP server to `127.0.0.1` or `::1` on an ephemeral port.
2. Generate at least 192 bits of randomness encoded as 32–128 URL-safe characters.
3. Serve the payload once at `/lobehub/provider-import/<token>`.
4. Open the URL below with the operating system:

```text
lobehub://provider/import?callback=http%3A%2F%2F127.0.0.1%3A49152%2Flobehub%2Fprovider-import%2F<token>
```

The callback must return HTTP 200 with `Content-Type: application/json` or
`application/vnd.lobehub.provider-import+json`. LobeHub refuses redirects, applies a 10-second
timeout, reads at most 256 KiB, and connects directly instead of using the configured application
proxy. Close the callback after its first request or after a short expiry even if no request
arrives.

## Payload version 1

```json
{
  "models": [
    {
      "id": "example-model",
      "displayName": "Example Model",
      "contextWindowTokens": 128000
    }
  ],
  "provider": {
    "id": "example-provider",
    "name": "Example Provider",
    "description": "Optional description",
    "logo": "https://example.com/icon.png",
    "baseURL": "https://api.example.com/v1",
    "apiKey": "provider-api-key",
    "checkModel": "example-model",
    "enableResponsesApi": false,
    "fetchOnClient": false
  },
  "version": 1
}
```

LobeHub validates the complete payload and then presents a confirmation dialog with the provider,
endpoint, and model count. Nothing is persisted until the user confirms. Importing an existing
custom provider requires an explicit overwrite confirmation that names the existing provider.
Built-in providers cannot be replaced. If a later write fails after a new provider was created,
the dialog remains open and the same import can be retried safely without fetching the one-shot
credential again.

Provider IDs use lowercase letters, digits, and hyphens. Model IDs may include provider-specific
punctuation but must not contain control characters or surrounding whitespace. Model IDs are
limited to 150 characters and display names to 200 characters, matching the persisted schema.
HTTP provider endpoints are accepted only for literal loopback addresses; all remote endpoints
must use HTTPS.
