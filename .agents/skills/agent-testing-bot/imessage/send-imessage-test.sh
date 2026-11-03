#!/usr/bin/env bash
#
# send-imessage-test.sh — Verify the outbound leg: desktop → BlueBubbles → iMessage
#
# Sends one real iMessage via the same REST call the Desktop bridge uses
# (`POST /api/v1/message/text`, which BlueBubblesApiClient.sendText wraps) and
# confirms it actually went out.
#
# KEY GOTCHA: with method=apple-script and a NEW conversation, the HTTP request
# often TIMES OUT even though the message is sent. Do NOT treat the timeout as a
# failure — instead poll `POST /api/v1/message/query` and check the message's
# `error` field (0 = sent OK). This script does that for you.
#
# This sends a REAL message, so it has side effects. Target your own number.
#
# Usage:
#   ./send-imessage-test.sh <bb_password> <target_e164> [message] [bb_url]
#
# Example (send to your own phone, E.164 with country code):
#   ./send-imessage-test.sh 'my-bb-pass' '+15551234567'
#
set -euo pipefail

BB_PASS="${1:?Usage: $0 <bb_password> <target_e164(+countrycode)> [message] [bb_url]}"
TARGET="${2:?Need a target handle in E.164, e.g. +15551234567 (or an Apple ID email)}"
MARKER="lobe-imsg-test-$(date +%s)"
MESSAGE="${3:-[${MARKER}] desktop bridge → BlueBubbles → iMessage outbound check}"
BB_URL="${4:-http://127.0.0.1:1234}"

CHAT_GUID="iMessage;-;${TARGET}"

echo "[send-test] target=${TARGET}  marker=${MARKER}"

# 1) Fire the send. apple-script on a new chat may hang the HTTP response, so we
#    cap it short and ignore a timeout — step 2 is the source of truth.
python3 - "$BB_PASS" "$BB_URL" "$CHAT_GUID" "$MESSAGE" <<'PY' || true
import json,sys,urllib.request,urllib.parse,uuid
pw,base,guid,msg=sys.argv[1:5]
url=base+"/api/v1/message/text?password="+urllib.parse.quote(pw)
body={"chatGuid":guid,"message":msg,"method":"apple-script","tempGuid":str(uuid.uuid4())}
req=urllib.request.Request(url,data=json.dumps(body).encode("utf-8"),
    headers={"Content-Type":"application/json"},method="POST")
try:
    r=urllib.request.urlopen(req,timeout=8)
    print("[send-test] HTTP",r.status,"(immediate response)")
except urllib.error.HTTPError as e:
    print("[send-test] HTTP",e.code,e.read().decode()[:200])
except Exception as e:
    print("[send-test] HTTP request returned no body (likely apple-script delay):",type(e).__name__)
PY

# 2) Source of truth: find our marker in the message store and read its error.
echo "[send-test] verifying via message/query (the HTTP timeout above is expected)…"
sleep 3
python3 - "$BB_PASS" "$BB_URL" "$MARKER" <<'PY'
import json,sys,time,urllib.request,urllib.parse
pw,base,marker=sys.argv[1:4]
url=base+"/api/v1/message/query?password="+urllib.parse.quote(pw)
def query():
    body={"limit":15,"offset":0,"with":["chats"],"sort":"DESC"}
    req=urllib.request.Request(url,data=json.dumps(body).encode(),
        headers={"Content-Type":"application/json"},method="POST")
    return json.load(urllib.request.urlopen(req,timeout=12)).get("data") or []
hit=None
for _ in range(5):
    for m in query():
        if marker in (m.get("text") or "") and m.get("isFromMe"):
            hit=m; break
    if hit: break
    time.sleep(2)
if not hit:
    print("[send-test] ✗ outbound message not found in BB store — send likely failed")
    sys.exit(1)
err=hit.get("error")
if err in (0,None):
    print("[send-test] ✓ outbound message sent (fromMe=True, error=%s)"%err)
    print("[send-test]   → confirm it arrived in the Messages app on the target device")
else:
    print("[send-test] ✗ BlueBubbles reported send error=%s"%err)
    sys.exit(1)
PY
