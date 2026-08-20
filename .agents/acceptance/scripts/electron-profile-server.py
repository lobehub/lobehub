#!/usr/bin/env python3
"""Point an Electron dev profile at a given backend, dropping foreign tokens.

Called by electron-dev.sh before every launch. See the "Why the profile is
isolated" block there for the failure this prevents.

What decides whether the OAuth tokens survive is the DATABASE, not the URL: the
refresh grant is a row in the backend's database, so a token minted by another
agent-testing worktree still refreshes fine against this run's server (they share
one Postgres) while a token minted by the user's own app — or by production —
can never refresh here, and fails `invalid_grant` on every boot. So we stamp the
profile with the database it was signed into and keep the tokens only when that
still matches. An unstamped profile is by definition one we did not manage (the
user's own app, or a fresh copy of it), so its tokens go.

Usage: electron-profile-server.py <lobehub-settings.json> <server-url> [database-url]
Prints one line describing what changed.
"""

import json
import pathlib
import sys

STAMP_KEY = "agentTestingProfile"


def load(path: pathlib.Path) -> dict:
    try:
        settings = json.loads(path.read_text()) if path.is_file() else {}
    except Exception:
        # A corrupt or half-written settings file is not worth failing a launch
        # over — the app rewrites it from defaults anyway.
        return {}
    return settings if isinstance(settings, dict) else {}


def main() -> int:
    path = pathlib.Path(sys.argv[1])
    server_url = sys.argv[2]
    database_url = sys.argv[3] if len(sys.argv) > 3 else ""

    settings = load(path)

    config = settings.get("dataSyncConfig")
    if not isinstance(config, dict):
        config = {}
    previous_url = config.get("remoteServerUrl")

    stamp = settings.get(STAMP_KEY)
    stamp = stamp if isinstance(stamp, dict) else {}
    same_database = bool(database_url) and stamp.get("databaseUrl") == database_url

    if previous_url == server_url and same_database:
        print(f"already points at {server_url}")
        return 0

    config["remoteServerUrl"] = server_url
    config.setdefault("storageMode", "selfHost")
    config["active"] = True
    settings["dataSyncConfig"] = config
    settings[STAMP_KEY] = {"databaseUrl": database_url, "serverUrl": server_url}

    dropped = False
    if not same_database:
        dropped = settings.pop("encryptedTokens", None) is not None

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings))

    if previous_url == server_url:
        changed = f"stamped {server_url}"
    else:
        changed = f"{previous_url or '(unset)'} -> {server_url}"
    if dropped:
        changed += "; dropped tokens signed into another database"
    elif same_database:
        changed += "; kept tokens (same database)"
    print(changed)

    return 0


if __name__ == "__main__":
    sys.exit(main())
