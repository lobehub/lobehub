# Migrating legacy task clients

## Upgrade from the custom-prefix API

The `--prefix` option was removed. Stop passing that option when upgrading your scripts.
For existing REST clients, remove `identifierPrefix` from requests; old payloads remain
accepted, and their supplied prefix is ignored in favor of the server-assigned identifier.
