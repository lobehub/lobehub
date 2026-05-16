#!/usr/bin/env python3
import json
import re
from pathlib import Path

# Tinglish generator notes:
# - We generate from en-US strings to avoid mangling English spellings (file, url, settings, etc.).
# - Then we apply colloquial phrase-level conversions into Telugu-in-English letters for UI tone.

# Segments that must remain unchanged
# Mask everything that should remain unchanged during replacements.
# Note: `{{...}}` placeholders are masked AFTER placeholder-aware replacements run,
# to prevent accidental edits to placeholder names (e.g. `{{failed}}`).
MASKED_RE = re.compile(r"(\{\{[^}]+\}\}|</?\\d+>|</?[a-zA-Z][^>]*>|%\\w|\\$\\{[^}]+\\}|\\\\n)")

# Zero-width / formatting chars that should never reach UI text
ZW_CHARS_RE = re.compile(r"[\u200b\u200c\u200d\u2060\ufeff]")

# Replacements that intentionally match across `{{...}}` placeholders.
# These run BEFORE placeholder masking.
PLACEHOLDER_AWARE_REPLACEMENTS = [
    (re.compile(r"\bdelete the selected (\{\{count\}\}) files\b", re.I), r"select chesina \1 files delete"),
    (re.compile(r"select chesina (\{\{count\}\}) files delete\.", re.I), r"select chesina \1 files delete cheyyabothunnaru."),
]

# Post processing: colloquial Tinglish (Telugu + English) using English spellings for nouns.
# Conservative by design: only transform strings that look complex (sentences/dialogs/tooltips).
REPLACEMENTS = [
    # Normalize some casing
    (re.compile(r"^File\b"), "file"),

    # FileManager-style phrases (keep English nouns, Telugu grammar)
    (re.compile(r"\bdelete this file\b", re.I), "ee file delete"),
    (re.compile(r"\bdelete this folder\b", re.I), "ee folder delete"),
    (re.compile(r"\bdelete this folder and all of its contents\b", re.I), "ee folder and lopala unna anni contents delete"),
    (re.compile(r"\bdelete all results in the current view\b", re.I), "current view lo unna anni results delete"),
    (re.compile(r"\bYou are about to\b", re.I), "Meeru ippudu"),
    (re.compile(r"\bee file delete\.", re.I), "ee file delete cheyyabothunnaru."),

    # Common action results
    (re.compile(r"\bcopied successfully\.?$", re.I), "successful ga copy aindhi"),
    (re.compile(r"\bdeleted successfully\.?$", re.I), "successful ga delete aindhi"),
    (re.compile(r"\bmoved successfully\.?$", re.I), "successful ga move aindhi"),
    (re.compile(r"\bremoved successfully\.?$", re.I), "successful ga remove aindhi"),
    (re.compile(r"\bupdated successfully\.?$", re.I), "successful ga update aindhi"),
    (re.compile(r"\bsaved successfully\.?$", re.I), "successful ga save aindhi"),
    (re.compile(r"\bcreated successfully\.?$", re.I), "successful ga create aindhi"),
    (re.compile(r"\brenamed successfully\.?$", re.I), "successful ga rename aindhi"),
    (re.compile(r"\bRename successful\.?$", re.I), "Rename successful aindhi"),

    # Generic "Successfully ..." patterns
    (re.compile(r"\bSuccessfully copied\b", re.I), "successful ga copy aindhi"),
    (re.compile(r"\bSuccessfully deleted\b", re.I), "successful ga delete aindhi"),

    # Errors / failures
    (re.compile(r"^Failed to (.+)$", re.I), lambda m: f"{m.group(1)} cheyyadam fail aindhi"),
    (re.compile(r"\bFailed\b", re.I), "fail aindhi"),
    (re.compile(r"\bError\b", re.I), "error"),

    # Loading/progress
    (re.compile(r"\bLoading\.\.\.$", re.I), "loading avutundi..."),
    (re.compile(r"\bLoading\b", re.I), "loading"),
    (re.compile(r"\bPreparing\.\.\.$", re.I), "prepare avutundi..."),
    (re.compile(r"\bMoving\.\.\.$", re.I), "move avutundi..."),
    (re.compile(r"\bDownloading file\.\.\.$", re.I), "file download avutundi..."),

    # Click / confirm
    (re.compile(r"^Click to (.+)$", re.I), lambda m: f"{m.group(1)} kosam click cheyyandi"),
    (re.compile(r"\bPlease confirm your action\.?$", re.I), "confirm cheyyandi"),
    (re.compile(r"\bPlease confirm your decision\.?$", re.I), "confirm cheyyandi"),
    (re.compile(r"\bConfirm to continue\.?$", re.I), "continue avvalante confirm cheyyandi"),
    (re.compile(r"\bPlease\b", re.I), "please"),

    # Drag/drop/upload common text
    (re.compile(r"^Drag files or folders here$", re.I), "files or folders ni ikkadiki drag cheyyandi"),
    (re.compile(r"^Drag and drop files here to upload multiple images\.$", re.I), "multiple images upload cheyyadaniki files ni ikkadiki drag & drop cheyyandi"),
    (re.compile(r"^Drag and drop images and files here to upload multiple images and files\.$", re.I), "multiple images & files upload cheyyadaniki images and files ni ikkadiki drag & drop cheyyandi"),
    (re.compile(r"^Click or drag to upload$", re.I), "upload kosam click cheyyandi leda drag cheyyandi"),

    # Common UI sentences / patterns
    (re.compile(r"^No (.+) found$", re.I), lambda m: f"{m.group(1)} em dorakaledhu"),
    (re.compile(r"^No (.+) available$", re.I), lambda m: f"{m.group(1)} em levu"),
    (re.compile(r"^Search (.+)\.\.\.$", re.I), lambda m: f"{m.group(1)} search cheyyandi..."),
    (re.compile(r"^Go to previous page$", re.I), "previous page ki vellu"),
    (re.compile(r"^Go to next page$", re.I), "next page ki vellu"),
    (re.compile(r"^Go to parent folder$", re.I), "parent folder ki vellu"),

    # Confirm dialog helpers (common in FileManager etc.)
    (re.compile(r"\bYou are about to ([^.]+)\.", re.I), lambda m: f"Meeru ippudu {m.group(1)} cheyyabothunnaru."),
    (re.compile(r"Once deleted, it cannot be recovered\.", re.I), "Delete ayyaka recover cheyyalem."),
    (re.compile(r"Once deleted, they cannot be recovered\.", re.I), "Delete ayyaka recover cheyyalem."),
    (re.compile(r"This action cannot be undone\.", re.I), "Idi undo cheyyalem."),

    # Generic fallback: keep as a soft touch at the end so it doesn't break specific patterns above
    (re.compile(r"\bsuccessfully\b", re.I), "successful ga"),

    # Small utility words
    (re.compile(r"\bto upload\b", re.I), "upload cheyyadaniki"),
    (re.compile(r"\bto connect\b", re.I), "connect cheyyadaniki"),
    (re.compile(r"\bto install\b", re.I), "install cheyyadaniki"),
    (re.compile(r"\bto enable\b", re.I), "enable cheyyadaniki"),
    (re.compile(r"\bto continue\b", re.I), "continue cheyyadaniki"),
]


def should_transform(s: str, key: str) -> bool:
    # Only transform complex sentences/tooltips/dialogs.
    # Keep short/simple labels in English.
    s = s.strip()
    if not s:
        return False

    # Always transform confirm dialogs and long explanations in FileManager
    if key.startswith("FileManager.actions.confirm"):
        return True
    # Keep FileManager toasts/empty states in Tinglish (user-facing messages)
    if key.startswith("FileManager.actions.") and ("Success" in key or "Error" in key or "Failed" in key):
        return True
    if key.startswith("FileManager.emptyStatus."):
        return True
    if key.startswith("DragUpload."):
        return True

    # Leave short strings alone
    words = re.findall(r"[A-Za-z0-9']+", s)
    word_count = len(words)

    score = 0
    if len(s) >= 60:
        score += 3
    elif len(s) >= 35:
        score += 2
    elif len(s) >= 25:
        score += 1

    if word_count >= 10:
        score += 2
    elif word_count >= 6:
        score += 1

    if any(ch in s for ch in ".:;!?"):
        score += 1

    # Keywords that usually indicate harder English (tooltips/errors/warnings)
    if any(tok in s for tok in ["You are about to", "Once deleted", "cannot", "Please", "Drag and drop", "Drag files", "Failed to", "unsupported", "semantic", "embedding"]):
        score += 2

    return score >= 3


def apply_replacements(s: str) -> str:
    # Preserve edge whitespace so placeholders like `foo {{count}} bar` don't become `foo{{count}}bar`.
    lead = re.match(r"^\s+", s)
    trail = re.search(r"\s+$", s)
    lead_ws = lead.group(0) if lead else ""
    trail_ws = trail.group(0) if trail else ""
    core = s.strip()

    for pattern, repl in REPLACEMENTS:
        core = pattern.sub(repl, core)

    # light normalization
    core = re.sub(r"\s+", " ", core)

    return lead_ws + core + trail_ws


def tinglishify(value: str, key: str) -> str:
    value = ZW_CHARS_RE.sub("", value)
    if not should_transform(value, key):
        return value

    # Mask protected segments (placeholders/tags/etc.) so we can run replacements on the whole
    # string without accidentally editing them, while still allowing cross-placeholder matches.
    masked = value
    protected = []

    def repl(m: re.Match) -> str:
        idx = len(protected)
        protected.append(m.group(0))
        return f"__PH{idx}__"

    # 1) placeholder-aware pass (placeholders still visible)
    for pattern, repl_value in PLACEHOLDER_AWARE_REPLACEMENTS:
        masked = pattern.sub(repl_value, masked)

    # 2) mask placeholders/tags/etc.
    masked = MASKED_RE.sub(repl, masked)
    masked = ZW_CHARS_RE.sub("", masked)

    out = apply_replacements(masked)

    # Restore protected tokens
    for i, raw in enumerate(protected):
        out = out.replace(f"__PH{i}__", raw)

    # Normalize internal whitespace a bit
    out = re.sub(r"\s{2,}", " ", out)
    return out


def main():
    root = Path(__file__).resolve().parents[1]
    en_dir = root / "locales" / "en-US"
    ti_dir = root / "locales" / "ti-IN"

    if not en_dir.is_dir() or not ti_dir.is_dir():
        raise SystemExit("Missing locale dirs")

    files = sorted({p.name for p in en_dir.glob("*.json")})

    # Build ti-IN from en-US and transform to colloquial Tinglish.
    changed_files = 0
    for fname in files:
        en_path = en_dir / fname
        ti_path = ti_dir / fname

        if not en_path.exists():
            continue

        en_obj = json.loads(en_path.read_text(encoding="utf-8"))

        out_obj = {}
        for k, en_val in en_obj.items():
            if isinstance(en_val, str):
                out_obj[k] = tinglishify(en_val, k)
            else:
                out_obj[k] = en_val

        ti_path.write_text(json.dumps(out_obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        changed_files += 1

    print(f"Updated {changed_files} files in locales/ti-IN")


if __name__ == "__main__":
    main()
