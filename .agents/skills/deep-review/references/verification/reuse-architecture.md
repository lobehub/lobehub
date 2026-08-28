# Reuse-Architecture Verification Addendum

Apply only to `reuse-architecture` dedup findings.

Open every entry in `existing_implementations` with enough surrounding context to compare behavior:

- At least one implementation has equivalent input, output, and side effects → `confirmed`.
- All implementations are merely syntactically similar → `false_positive`, naming the semantic
  difference.
- Required context is unavailable → `need_more_context`.

Reuse-architecture findings default to `can_auto_fix: false` because caller migration changes the
blast radius. A constant or single-import swap with no signature change may be auto-fixable when the
evidence says why.
