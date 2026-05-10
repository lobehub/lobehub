"""Diagnostica tag emaxlele nel repo."""
import sys, io
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO, git, git_soft

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

print('=== Branch corrente ===')
print(git('branch', '--show-current'))

print('\n=== Ultimi 5 tag *emaxlele* ===')
ok, tags_raw, _ = git_soft('tag', '--list', '*emaxlele*', '--sort=-creatordate')
tags = [t for t in tags_raw.splitlines() if t][:5] if ok else []
for t in tags:
    commit = git('rev-list', '-n1', t)
    ok2, branches, _ = git_soft('branch', '--all', '--contains', commit)
    branches_clean = ' | '.join(b.strip().lstrip('* ') for b in branches.splitlines() if b.strip())
    print(f'  {t} -> {commit[:8]} | in branches: {branches_clean}')

print('\n=== HEAD dei branch chiave ===')
for branch in ['emaxlele-dev', 'origin/emaxlele-dev', 'upstream/canary']:
    ok3, h, _ = git_soft('rev-parse', '--short', branch)
    print(f'  {branch}: {h if ok3 else "N/A"}')

print('\n=== Ultimi 4 commit su emaxlele-dev ===')
print(git('log', 'emaxlele-dev', '-4', '--oneline'))

print('\n=== Ultimi 4 commit su upstream/canary ===')
ok4, out4, _ = git_soft('log', 'upstream/canary', '-4', '--oneline')
print(out4 if ok4 else "N/A")

sys.stdout.flush()
