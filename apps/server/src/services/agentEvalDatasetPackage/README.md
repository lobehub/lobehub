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
database IDs, ownership fields, system flags or credentials. Mock tool packages
must supply `dataset.metadata.mock.dataset`, the routing segment on the deployment's
configured mock service. This does not deploy a mock or bind an arbitrary MCP URL.
User-defined MCP connection binding is a separate feature. Grading configuration
is kept as authored; a successful import does not validate remote dependencies.

## Behavior and limits

- Upload: at most 10 MiB compressed, 32 MiB expanded in total; `dataset.json` at most
  25 MiB. At most 50 ZIP entries, 5,000 cases and 500 shared environments.
- Optional `README.md`, directories and conventional macOS metadata are tolerated.
  Other data files are rejected, so unimported case files cannot be silently lost.
- Unsafe paths, duplicates, encrypted/multipart/ZIP64 archives, checksum errors,
  truncated data and unsupported compression are rejected before database writes.
- Preview checks the complete package and displays sample inputs and counts.
  Confirmation validates the archive again, then imports all rows in one transaction.
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

Database migrations still create the evaluation tables. A content seed command is
not needed to start using LobeBench: users import separately distributed packages.
