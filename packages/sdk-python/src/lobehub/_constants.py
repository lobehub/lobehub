DEFAULT_BASE_URL = "https://app.lobehub.com"

# Generous on purpose: a non-streaming `responses.create` answers only once the agent run ends.
DEFAULT_TIMEOUT = 600.0
DEFAULT_MAX_RETRIES = 2

WORKSPACE_HEADER = "X-Workspace-Id"
IDEMPOTENCY_KEY_HEADER = "Idempotency-Key"
REQUEST_ID_HEADER = "X-Request-Id"
