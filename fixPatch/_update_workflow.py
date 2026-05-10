r"""
Aggiorna emaxlele-build.yml su GitHub via API per includere
la versione canary upstream nelle release notes.
Eseguire da: python fixPatch/_update_workflow.py (qualsiasi directory)
"""
import subprocess, sys, json, base64, re
from pathlib import Path

REPO_API = "https://api.github.com/repos/emaxlele/lobehub"
WORKFLOW_PATH = ".github/workflows/emaxlele-build.yml"
BRANCH = "emaxlele-dev"

# Leggi il file corrente via gh api
r = subprocess.run(
    ["gh", "api", f"/repos/emaxlele/lobehub/contents/{WORKFLOW_PATH}?ref={BRANCH}"],
    capture_output=True, text=True
)
if r.returncode != 0:
    print(f"Errore lettura: {r.stderr}")
    sys.exit(1)

data = json.loads(r.stdout)
sha = data["sha"]
content = base64.b64decode(data["content"].replace("\n", "")).decode("utf-8")

print("=== Sezione 'Generate release notes' originale ===")
# Trova la sezione da aggiornare
start = content.find("      - name: Generate release notes")
end   = content.find("\n  build-windows:", start)
print(content[start:end])
print("\n=== Fine sezione ===\n")

# Nuova sezione release notes con versione canary
OLD = """      - name: Generate release notes
        if: steps.check.outputs.should_build == 'true'
        id: notes
        run: |
          prev=$(git tag --sort=-creatordate | grep -E '^v[0-9]+\\.[0-9]+\\.[0-9]+-emaxlele\\.[0-9]+$' | head -n 1)
          base_stable=$(git tag --sort=-v:refname | grep -E '^v[0-9]+\\.[0-9]+\\.[0-9]+$' | head -n 1)
          compare_from=${prev:-$base_stable}
          range="${compare_from}..HEAD"
          commits=$(git log --no-merges --pretty='- `%h` %s (%an)' "$range")
          [ -z "$commits" ] && commits='- No new commits.'
          {
            echo "release_notes<<EOF"
            echo "## emaxlele-dev Build — ${{ steps.version.outputs.tag }}"
            echo
            echo "> Personal fork build — emaxlele. Based on ${compare_from}."
            echo
            printf '%s\\n' "$commits"
            echo "EOF"
          } >> $GITHUB_OUTPUT"""

NEW = """      - name: Generate release notes
        if: steps.check.outputs.should_build == 'true'
        id: notes
        run: |
          prev=$(git tag --sort=-creatordate | grep -E '^v[0-9]+\\.[0-9]+\\.[0-9]+-emaxlele\\.[0-9]+$' | head -n 1)
          base_stable=$(git tag --sort=-v:refname | grep -E '^v[0-9]+\\.[0-9]+\\.[0-9]+$' | head -n 1)
          compare_from=${prev:-$base_stable}
          range="${compare_from}..HEAD"
          commits=$(git log --no-merges --pretty='- `%h` %s (%an)' "$range")
          [ -z "$commits" ] && commits='- No new commits.'
          # Leggi versione canary upstream da package.json
          upstream_ver=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
          {
            echo "release_notes<<EOF"
            echo "## emaxlele-dev Build — ${{ steps.version.outputs.tag }}"
            echo
            echo "> Personal fork build — emaxlele."
            echo "> **Upstream canary: ${upstream_ver}**"
            echo "> Based on ${compare_from}."
            echo
            printf '%s\\n' "$commits"
            echo "EOF"
          } >> $GITHUB_OUTPUT"""

if OLD not in content:
    print("ATTENZIONE: sezione originale non trovata esattamente — stampo diff contesto:")
    for i, line in enumerate(content.splitlines()):
        if "Generate release notes" in line or "Personal fork build" in line or "Based on" in line:
            print(f"  L{i+1}: {line}")
    sys.exit(1)

new_content = content.replace(OLD, NEW, 1)
assert new_content != content, "Nessuna sostituzione effettuata!"

# Scrivi il file aggiornato su GitHub
encoded = base64.b64encode(new_content.encode("utf-8")).decode("utf-8")
payload = {
    "message": "ci(emaxlele-build): add upstream canary version to release notes\n\nInclude the upstream canary version from package.json in the\nrelease notes so it's always visible which upstream version\nthe emaxlele build is based on.",
    "content": encoded,
    "sha": sha,
    "branch": BRANCH
}

r2 = subprocess.run(
    ["gh", "api", f"/repos/emaxlele/lobehub/contents/{WORKFLOW_PATH}",
     "--method", "PUT", "--input", "-"],
    input=json.dumps(payload),
    capture_output=True, text=True
)
if r2.returncode != 0:
    print(f"Errore scrittura: {r2.stderr}")
    print(r2.stdout[:500])
    sys.exit(1)

result = json.loads(r2.stdout)
print(f"✓ Workflow aggiornato: {result['commit']['sha'][:8]}")
print(f"  Commit: {result['commit']['message'].splitlines()[0]}")
