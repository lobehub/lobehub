# Dataset ZIP packages

LobeBench's Dataset import reuses the Eval Lab upload dialog. A package imports
portable content into the current account or workspace; it never installs a
system benchmark. Benchmark assets are distributed separately and are not bundled
with this importer. The product does not provide example packages.

## Version 1

Place `dataset.json` directly at the ZIP root, without an enclosing folder. Its
`format` must be `lobehub-eval-dataset` and its `version` must be `1`.

`dataset` contains a name and optional description, grading mode/configuration,
and release/presentation/mock metadata. `cases` contains unique portable keys,
the existing structured case content (including conversation messages and inline
environment), optional grading mode/configuration, metadata and sort order.
`environments` contains unique keys, names and existing environment configuration.
A case's optional `environmentKey` references a key in this same package. The
importer generates new database IDs for all imported rows.
Every case must supply `evalMode` or inherit it from `dataset.evalMode`; grading
cannot depend on a system benchmark that may not exist on the recipient's server.

The contract is defined by `AgentEvalDatasetPackage` in `@lobechat/types`, validated
by `datasetPackageSchema` in the agentEval router. Case grading and environment
fields use the same schemas as existing case authoring. Grading rules are retained,
not inferred from a CSV column mapping. Importing does not execute a case or judge.

Root, dataset, case and environment envelopes reject unknown fields. Do not include
database IDs, ownership fields or system flags. Grading configuration is kept as
authored; a successful import does not validate remote dependencies.

## Mock connections

A private package can carry the connection settings needed by its cases. The
optional top-level `connections` object maps package-local keys to these fields:

| Field         | Purpose                                                                               |
| ------------- | ------------------------------------------------------------------------------------- |
| `name`        | Display name for the imported MCP connection.                                         |
| `url`         | HTTP or HTTPS MCP server address, without URL userinfo, query or fragment.            |
| `credentials` | Optional `{ type: 'bearer', token }` or `{ type: 'header', headers }` authentication. |

The credentials belong to that external mock service. They are not LobeHub's
deployment key and are not shared across every mock. Only distribute a private
package with credentials to recipients authorized to use that mock.

Each environment or case envelope can contain `connectionBindings`. Its keys are
the logical service identifiers used by the case; each value contains a
`connectionKey` referring to this package's `connections`, plus an optional
`transport`:

- `mcp` (the default) calls the selected server through the standard MCP protocol.
- `lobe-bench` uses that server's LobeBench session adapter to isolate case state.
  `dataset.metadata.mock.dataset`, when supplied, is its logical dataset segment.

Shared environments supply reusable bindings. Inline case bindings can replace
individual package bindings; the importer resolves the complete effective case
mapping. Declared bindings also declare their logical services. Installed
`config.connectorBindings` and connector database IDs are not accepted in ZIPs.

Import creates fresh, scoped `user_connectors` records for referenced definitions.
Credentials are encrypted before the database transaction. Environment and case
configuration store only the resolved connector IDs and transport; they do not
store URLs or credentials. Imported connections carry dataset/package provenance
and are excluded from normal chat's automatic connector discovery. Re-importing
the same package never overwrites an existing connection. No database migration
or global mock token is required.

The preview shows connection names, required services and whether authentication
was supplied; it never returns connection URLs or credential values. Import can
also select existing accessible connections, or leave missing bindings for later
configuration in the Dataset. Before a run starts, LobeHub checks the selected
connections and discovers their tools; the external mock verifies authentication.
Missing or invalid connections prevent execution. A run freezes connection
identity so changing an Environment cannot silently retarget that run.

Dataset connection repair preserves case content and release identity. An
environment shared with another dataset must be copied before changing its
connections through this repair flow. Imported connections are not automatically
deleted with a dataset because another environment may still reference them.
They remain independently managed connections. Remove an unused connection from
Settings explicitly; deleting a connection still used by a case makes that case
require a replacement binding before it can run.

Editing an imported connection preserves its evaluation-only provenance. Header
authentication stays encrypted even when the shared connector editor submits
headers as metadata. An omitted credential field keeps authentication, explicit
`null` clears it, and a credential object replaces it. When the address changes,
explicit `null` also discards headers resubmitted by the editor; retaining existing
authentication on a new address is rejected, while explicit replacement is allowed.

## Behavior and limits

- Upload: at most 10 MiB compressed, 32 MiB expanded in total; `dataset.json` at most
  25 MiB. At most 50 ZIP entries, 5,000 cases and 500 shared environments.
- Optional `README.md`, directories and conventional macOS metadata are tolerated.
  Other data files are rejected, so unimported case files cannot be silently lost.
- Unsafe paths, duplicates, encrypted/multipart/ZIP64 archives, checksum errors,
  truncated data and unsupported compression are rejected before database writes.
- Preview checks the complete package and displays sample inputs and counts.
  Confirmation validates the archive again, then imports connections, environments,
  cases and their dataset in one transaction. No external mock is contacted inside
  that transaction; failed imports leave none of these new records behind.
- New LobeBench datasets belong to an owned benchmark or a newly created benchmark.
  Existing empty owned datasets may receive a package only if they have no cases
  (including retired cases) and no runs. Otherwise import as a new dataset.
- Existing cases, runs and results are never overwritten. To distribute a revised
  package, import it as a new dataset and keep the old dataset for comparisons.
- Imported metadata records the package version and SHA256 of the original
  `dataset.json` bytes. Identical content with different ZIP timestamps has the same
  digest. This records source identity; it does not certify the external mock version.
- Failed imports retain their temporary upload for retry. Successful imports release
  it through the existing upload lifecycle; there is no public package download API.
  A private package's upload contains its supplied credentials until this cleanup
  or the temporary-upload expiry, so it remains an account-scoped temporary asset.

Database migrations still create the evaluation tables. A content seed command is
not needed to start using LobeBench: users import separately distributed packages.
