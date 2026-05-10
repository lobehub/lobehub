"""Legge e analizza RuntimeExecutors.ts per debugging."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO

path = REPO / 'src' / 'server' / 'modules' / 'AgentRuntime' / 'RuntimeExecutors.ts'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f'Total lines: {len(lines)}')
print('--- Lines mentioning onboardingContext / onboardingState / finished ---')
for i, line in enumerate(lines, 1):
    lo = line.lower()
    if 'onboardingcontext' in lo or 'onboardingstate' in lo or ('finished' in lo and 'onboard' in lo):
        print(f'{i}: {line}', end='')

print('\n--- Context around line 1 (first 80 lines) ---')
for i, line in enumerate(lines[:80], 1):
    print(f'{i}: {line}', end='')
