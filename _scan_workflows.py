import os, re

wf_dir = os.path.join(os.path.dirname(__file__), '.github', 'workflows')
results = []

for fname in sorted(os.listdir(wf_dir)):
    if not fname.endswith('.yml') and not fname.endswith('.yaml'):
        continue
    path = os.path.join(wf_dir, fname)
    content = open(path, encoding='utf-8', errors='ignore').read()

    # Cerca trigger push
    has_push = bool(re.search(r'^\s+push\s*:', content, re.MULTILINE))
    if not has_push:
        continue

    # Cerca se ha filtro branches
    has_branch_filter = bool(re.search(r'branches\s*:', content))

    results.append((fname, has_branch_filter))

print(f"{'FILE':<50} {'BRANCH FILTER'}")
print("-" * 65)
for fname, filtered in results:
    status = "OK (filtrato)" if filtered else "!!! SCATTA SU TUTTO"
    print(f"{fname:<50} {status}")
