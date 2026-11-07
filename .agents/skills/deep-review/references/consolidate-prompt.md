# Global Finding Consolidation Prompt

Run once after verification only when at least two confirmed findings remain. This pass does not
re-verify correctness; it identifies roots duplicated across verifier payloads.

Instantiate `{confirmed_findings}` with the confirmed findings after applying verifier overrides,
including id, dimension, location, summary, evidence, and fix options.

---

````text
Consolidate duplicate code-review findings. Do not change verdicts, severity, likelihood, evidence,
or fix options.

## Confirmed findings
{confirmed_findings}

Two findings share a root only when one concrete fix resolves both. Similar location, theme, or
dimension is not enough.

Choose the earliest finding in input order as the root. Return only later duplicate ids. Never:

- map an id to itself;
- invent an id;
- create a cycle;
- merge findings that require separate fixes; or
- merge a release-risk consequence with a code defect when fixing the defect would not also remove
  the release consequence.

Return exactly one valid JSON object in a `json` fence. No prose or comments.

```json
{
  "same_root": [
    {
      "id": "style-2",
      "same_root_as": "ai-1"
    }
  ]
}
```

When no duplicates exist, return `{"same_root":[]}`.
````
