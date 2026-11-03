# Bad learnings log fixture — every entry violates exactly the constraint named in its `expect-violation` comment.
# Used by tests/run.mjs to prove check-learnings.mjs rejects malformed write-backs.

```learning
id: LRN-20261014-91
date: 2026-10-14
status: open
symptom: 用户第二次说「别再加渐变文字」
source: user-correction
scenario: launch-visual
stage: 50-visual
occurrences: 2
root_cause: 只写在风格指南里
layer: style
layer_reason: 偷懒
why_not_code: 没想过
artifacts: A-04.2
regression: -
```
<!-- expect-violation: L-01 -->

```learning
id: LRN-20261014-92
date: 2026-10-14
status: landed
symptom: 声称落了 lint，但规则并不存在
source: review
scenario: -
stage: 50-visual
occurrences: 1
root_cause: -
layer: lint
layer_reason: -
artifacts: LOBE-DOES-NOT-EXIST
regression: tests/fixtures/bad.tsx
version: 2.1.0
```
<!-- expect-violation: L-02 -->

```learning
id: LRN-20261014-93
date: 2026-10-14
status: landed
symptom: 引用了不存在的规则编号
source: review
scenario: -
stage: 70-detail
occurrences: 1
root_cause: -
layer: rule
layer_reason: -
artifacts: X-9.9
regression: -
version: 2.1.0
```
<!-- expect-violation: L-03 -->

```learning
id: LRN-20261014-94
date: 2026-10-14
status: landed
symptom: 落地了但没写版本
source: review
scenario: -
stage: 70-detail
occurrences: 1
root_cause: -
layer: rule
layer_reason: -
artifacts: X-1.1
regression: -
```
<!-- expect-violation: L-04 -->

```learning
id: LRN-20261014-95
date: 2026-10-14
status: open
symptom: 只能靠人审却不说明为什么
source: review
scenario: -
stage: 20-direction
occurrences: 1
root_cause: -
layer: style
layer_reason: -
artifacts: A-01
regression: -
```
<!-- expect-violation: L-05 -->

```learning
id: LRN-20261014-96
date: 2026-10-14
status: open
symptom: 复发时反而降级
source: user-correction
scenario: -
stage: 50-visual
occurrences: 3
previous_layer: lint
root_cause: -
layer: rule
layer_reason: -
artifacts: A-02
regression: -
```
<!-- expect-violation: L-01 -->

```learning
id: bad-id
date: 14/10/2026
status: done
symptom: 字段不合法
source: chat
stage: 50-visual
occurrences: 1
root_cause: -
layer: prompt
layer_reason: -
artifacts: -
regression: -
```
<!-- expect-violation: format -->
