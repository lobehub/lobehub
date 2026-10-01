#!/usr/bin/env bash
# Acceptance resource guard: bound a run's memory cost so a long or crashed run
# cannot push the host into swap thrash and freeze the machine (and the client
# driving the run).
#
# Usage:
#   bash resource-guard.sh check  [options]          one sample; prints a verdict
#   bash resource-guard.sh start  [options]          start this run's background sampler
#   bash resource-guard.sh claim  --state-dir DIR --pid PID   register a process this run started
#   bash resource-guard.sh stop   --state-dir DIR    stop the sampler this run started
#   bash resource-guard.sh status --state-dir DIR    print the run's recorded guard state
#
# Options:
#   --state-dir DIR        state directory (required for start/claim/stop/status)
#   --pid PID              repeatable; claim: a process this run started. `start`
#                          clears previous claims, so claim within the current run
#   --run-tag TAG          this run's tag; a process whose command line contains it
#                          counts as owned even when it predates the guard
#   --interval SECONDS     sampling interval for start (default 10)
#   --group NAME=PATTERN   repeatable; an ERE matched against each process command line
#   --yellow SPEC          yellow-tier thresholds (default swap=70,free=25)
#   --red SPEC             red-tier thresholds (default swap=85,free=10)
#   --on-red ACTION        warn (default) | stop-owned
#   --grace SECONDS        TERM to KILL grace for stop-owned (default 5)
#   --json                 (check/status) emit JSON instead of a human line
#
# Spec: comma-separated KEY=VALUE, any subset of
#   swap=PCT   free=PCT   total.rss=MB   group.NAME.rss=MB   group.NAME.count=N
# total.rss is the summed RSS of the declared groups, so it stays 0 without --group.
# Ownership is positive, never inferred from timing: a process belongs to this run
# only when its command line contains the run tag, or it was registered with `claim`,
# or it descends from a claimed process. A process that merely appeared after the guard
# started is NOT owned — an overlapping run starting the same browser or dev server
# would otherwise be stopped by this one. stop-owned only ever stops owned processes,
# and only in the groups named with --group: never a process-name kill.
#
# Exit (check): 0 green, 10 yellow, 20 red, 2 unsupported platform or bad usage.
set -uo pipefail

PROG='[resource-guard]'

fail() { echo "$PROG $*" >&2; exit 2; }

MODE="${1:-}"
case "$MODE" in
  check|start|claim|stop|status|__watch) shift ;;
  ''|--help|-h) fail "Usage: bash resource-guard.sh check|start|claim|stop|status [options]" ;;
  *) fail "Unknown command: $MODE" ;;
esac

STATE_DIR=""
PIDS=""
RUN_TAG=""
INTERVAL=10
ON_RED=warn
GRACE=5
JSON=0
YELLOW="swap=70,free=25"
RED="swap=85,free=10"
GROUP_SPECS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --state-dir) [ $# -ge 2 ] || fail "--state-dir needs a value"; STATE_DIR="$2"; shift 2 ;;
    --pid)       [ $# -ge 2 ] || fail "--pid needs a value";       PIDS="${PIDS}${2}"$'\n'; shift 2 ;;
    --run-tag)   [ $# -ge 2 ] || fail "--run-tag needs a value";   RUN_TAG="$2";   shift 2 ;;
    --interval)  [ $# -ge 2 ] || fail "--interval needs a value";  INTERVAL="$2";  shift 2 ;;
    --group)     [ $# -ge 2 ] || fail "--group needs a value";     GROUP_SPECS="${GROUP_SPECS}${2}"$'\n'; shift 2 ;;
    --yellow)    [ $# -ge 2 ] || fail "--yellow needs a value";    YELLOW="$2";    shift 2 ;;
    --red)       [ $# -ge 2 ] || fail "--red needs a value";       RED="$2";       shift 2 ;;
    --on-red)    [ $# -ge 2 ] || fail "--on-red needs a value";    ON_RED="$2";    shift 2 ;;
    --grace)     [ $# -ge 2 ] || fail "--grace needs a value";     GRACE="$2";     shift 2 ;;
    --json)      JSON=1; shift ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
case "$ON_RED" in warn|stop-owned) ;; *) fail "--on-red must be warn or stop-owned" ;; esac

platform_name() { uname -s 2>/dev/null || echo unknown; }

# -> "usedPct usedMb totalMb"; nonzero when the platform or tools cannot answer.
read_swap() {
  case "$(platform_name)" in
    Darwin)
      local out total used
      out="$(sysctl -n vm.swapusage 2>/dev/null)" || return 1
      total="$(printf '%s\n' "$out" | sed -n 's/.*total = \([0-9.]*\)M.*/\1/p')"
      used="$(printf '%s\n' "$out" | sed -n 's/.*used = \([0-9.]*\)M.*/\1/p')"
      [ -n "$total" ] && [ -n "$used" ] || return 1
      awk -v u="$used" -v t="$total" \
        'BEGIN{ if (t+0<=0) print "0 0 0"; else printf "%.1f %d %d\n", u/t*100, u+0.5, t+0.5 }'
      ;;
    Linux)
      [ -r /proc/meminfo ] || return 1
      awk -F'[: ]+' '/^SwapTotal:/{t=$2} /^SwapFree:/{f=$2} END{
          if (t=="") t=0; if (f=="") f=0;
          if (t+0<=0) print "0 0 0"; else printf "%.1f %d %d\n", (t-f)/t*100, (t-f)/1024, t/1024
        }' /proc/meminfo
      ;;
    *) return 1 ;;
  esac
}

# -> "pct"; nonzero when unavailable.
read_free() {
  case "$(platform_name)" in
    Darwin)
      local memsize vmout pagesize free_pages spec_pages
      memsize="$(sysctl -n hw.memsize 2>/dev/null)" || return 1
      vmout="$(vm_stat 2>/dev/null)" || return 1
      [ -n "$vmout" ] || return 1
      pagesize="$(printf '%s\n' "$vmout" | sed -n 's/.*page size of \([0-9]*\) bytes.*/\1/p' | head -1)"
      free_pages="$(printf '%s\n' "$vmout" | sed -n 's/^Pages free:[[:space:]]*\([0-9]*\)\..*/\1/p' | head -1)"
      spec_pages="$(printf '%s\n' "$vmout" | sed -n 's/^Pages speculative:[[:space:]]*\([0-9]*\)\..*/\1/p' | head -1)"
      awk -v m="$memsize" -v p="${pagesize:-4096}" -v f="${free_pages:-0}" -v s="${spec_pages:-0}" \
        'BEGIN{ if (m+0<=0) print 0; else printf "%.0f\n", (f+s)*p/m*100 }'
      ;;
    Linux)
      [ -r /proc/meminfo ] || return 1
      awk -F'[: ]+' '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{
          if (t+0<=0) print 0; else printf "%.0f\n", a/t*100
        }' /proc/meminfo
      ;;
    *) return 1 ;;
  esac
}

# Process table as "count rssMb" for an ERE, excluding the guard itself.
group_stats() {
  ps -Ao pid=,rss=,command= 2>/dev/null \
    | grep -E -e "$1" \
    | grep -vF 'resource-guard.sh' \
    | awk 'BEGIN{ c=0; k=0 } { c++; k+=$2 } END{ printf "%d %d\n", c, k/1024 }'
}

spec_value() {
  printf '%s\n' "$1" | tr ',' '\n' | awk -F= -v k="$2" '$1==k { print $2; exit }'
}

ge() { [ -n "$2" ] && awk -v a="$1" -v b="$2" 'BEGIN{ exit !(a+0>=b+0) }'; }

# Emits one JSON sample on stdout; read the tier back with tier_of.
emit_sample() {
  local groups="$1" yellow="$2" red="$3"
  local swap_out free_out swap_pct swap_mb swap_total free_pct
  local breaches="" tier="green" line name pattern stats count rss yv rv
  local total_rss=0

  swap_out="$(read_swap || true)"
  free_out="$(read_free || true)"
  swap_pct=""; swap_mb=""; swap_total=""; free_pct=""
  if [ -n "$swap_out" ]; then read -r swap_pct swap_mb swap_total <<< "$swap_out"; fi
  if [ -n "$free_out" ]; then free_pct="$free_out"; fi

  local swap_json="null" free_json="null"
  if [ -n "$swap_pct" ]; then
    swap_json="{\"usedPct\":${swap_pct},\"usedMb\":${swap_mb},\"totalMb\":${swap_total}}"
  fi
  if [ -n "$free_pct" ]; then free_json="{\"pct\":${free_pct}}"; fi

  local groups_json="" first_group=1
  if [ -n "$groups" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      name="${line%%=*}"; pattern="${line#*=}"
      stats="$(group_stats "$pattern")"
      read -r count rss <<< "$stats"
      [ "$first_group" = 1 ] || groups_json="${groups_json},"
      first_group=0
      groups_json="${groups_json}\"${name}\":{\"count\":${count},\"rssMb\":${rss}}"
      [ -n "$rss" ] && total_rss=$((total_rss + rss))
      yv="$(spec_value "$yellow" "group.${name}.rss")"; rv="$(spec_value "$red" "group.${name}.rss")"
      if ge "$rss" "$rv"; then
        tier="red"; breaches="${breaches}{\"metric\":\"group.${name}.rss\",\"value\":${rss},\"threshold\":${rv},\"tier\":\"red\"},"
      elif ge "$rss" "$yv"; then
        [ "$tier" = red ] || tier="yellow"
        breaches="${breaches}{\"metric\":\"group.${name}.rss\",\"value\":${rss},\"threshold\":${yv},\"tier\":\"yellow\"},"
      fi
      yv="$(spec_value "$yellow" "group.${name}.count")"; rv="$(spec_value "$red" "group.${name}.count")"
      if ge "$count" "$rv"; then
        tier="red"; breaches="${breaches}{\"metric\":\"group.${name}.count\",\"value\":${count},\"threshold\":${rv},\"tier\":\"red\"},"
      elif ge "$count" "$yv"; then
        [ "$tier" = red ] || tier="yellow"
        breaches="${breaches}{\"metric\":\"group.${name}.count\",\"value\":${count},\"threshold\":${yv},\"tier\":\"yellow\"},"
      fi
    done <<< "$groups"
  fi

  # total.rss bounds the summed RSS of the declared groups and is evaluated
  # whenever it is configured: a threshold the operator set must never be ignored.
  yv="$(spec_value "$yellow" total.rss)"; rv="$(spec_value "$red" total.rss)"
  if ge "$total_rss" "$rv"; then
    tier="red"; breaches="${breaches}{\"metric\":\"total.rss\",\"value\":${total_rss},\"threshold\":${rv},\"tier\":\"red\"},"
  elif ge "$total_rss" "$yv"; then
    [ "$tier" = red ] || tier="yellow"
    breaches="${breaches}{\"metric\":\"total.rss\",\"value\":${total_rss},\"threshold\":${yv},\"tier\":\"yellow\"},"
  fi

  if [ -n "$swap_pct" ]; then
    yv="$(spec_value "$yellow" swap)"; rv="$(spec_value "$red" swap)"
    if ge "$swap_pct" "$rv"; then
      tier="red"; breaches="${breaches}{\"metric\":\"swap\",\"value\":${swap_pct},\"threshold\":${rv},\"tier\":\"red\"},"
    elif ge "$swap_pct" "$yv"; then
      [ "$tier" = red ] || tier="yellow"
      breaches="${breaches}{\"metric\":\"swap\",\"value\":${swap_pct},\"threshold\":${yv},\"tier\":\"yellow\"},"
    fi
  fi
  if [ -n "$free_pct" ]; then
    yv="$(spec_value "$yellow" free)"; rv="$(spec_value "$red" free)"
    if [ -n "$rv" ] && awk -v v="$free_pct" -v t="$rv" 'BEGIN{ exit !(v+0<=t+0) }'; then
      tier="red"; breaches="${breaches}{\"metric\":\"free\",\"value\":${free_pct},\"threshold\":${rv},\"tier\":\"red\"},"
    elif [ -n "$yv" ] && awk -v v="$free_pct" -v t="$yv" 'BEGIN{ exit !(v+0<=t+0) }'; then
      [ "$tier" = red ] || tier="yellow"
      breaches="${breaches}{\"metric\":\"free\",\"value\":${free_pct},\"threshold\":${yv},\"tier\":\"yellow\"},"
    fi
  fi
  breaches="${breaches%,}"

  printf '{"ts":%s,"platform":"%s","tier":"%s","swap":%s,"free":%s,"totalRssMb":%s,"groups":{%s},"breaches":[%s]}\n' \
    "$(date +%s)" "$(platform_name)" "$tier" "$swap_json" "$free_json" "$total_rss" "$groups_json" "$breaches"
}

count_lines() { [ -f "$1" ] || { echo 0; return; }; local n; n="$(wc -l < "$1" | tr -d ' ')"; echo "${n:-0}"; }
count_match() { [ -f "$2" ] || { echo 0; return; }; local n; n="$(grep -c -e "$1" "$2" 2>/dev/null)"; echo "${n:-0}"; }
tier_of() { printf '%s\n' "$1" | sed -n 's/.*"tier":"\([a-z]*\)".*/\1/p'; }

# --- modes -------------------------------------------------------------------

do_check() {
  local plat
  plat="$(platform_name)"
  case "$plat" in Darwin|Linux) ;; *) fail "Unsupported platform: $plat" ;; esac

  local tdir=""
  if [ -z "$STATE_DIR" ]; then
    tdir="$(mktemp -d "${TMPDIR:-/tmp}/acceptance-guard.XXXXXX")" || fail "mktemp failed"
    STATE_DIR="$tdir"
  fi
  local sample tier
  sample="$(emit_sample "$GROUP_SPECS" "$YELLOW" "$RED")"
  tier="$(tier_of "$sample")"
  [ -n "$tdir" ] && rm -rf "$tdir"

  if [ "$JSON" = 1 ]; then
    printf '%s\n' "$sample"
  else
    printf '%s %s\n' "$PROG" "$tier"
  fi
  case "$tier" in
    green) exit 0 ;;
    yellow) exit 10 ;;
    *) exit 20 ;;
  esac
}

write_config() {
  {
    printf 'RUN_TAG=%s\n' "$RUN_TAG"
    printf 'INTERVAL=%s\n' "$INTERVAL"
    printf 'ON_RED=%s\n' "$ON_RED"
    printf 'GRACE=%s\n' "$GRACE"
    printf 'YELLOW=%s\n' "$YELLOW"
    printf 'RED=%s\n' "$RED"
    printf '%s' "$GROUP_SPECS" | while IFS= read -r g; do [ -n "$g" ] && printf 'GROUP=%s\n' "$g"; done
  } > "$STATE_DIR/config"
}

load_config() {
  RUN_TAG=""; INTERVAL=10; ON_RED=warn; GRACE=5
  YELLOW="swap=70,free=25"; RED="swap=85,free=10"; GROUP_SPECS=""
  local line key value
  while IFS= read -r line; do
    key="${line%%=*}"; value="${line#*=}"
    case "$key" in
      RUN_TAG) RUN_TAG="$value" ;;
      INTERVAL) INTERVAL="$value" ;;
      ON_RED) ON_RED="$value" ;;
      GRACE) GRACE="$value" ;;
      YELLOW) YELLOW="$value" ;;
      RED) RED="$value" ;;
      GROUP) GROUP_SPECS="${GROUP_SPECS}${value}"$'\n' ;;
    esac
  done < "$STATE_DIR/config"
}

# Ownership is proof, never timing. A process that appeared after start is only
# owned once the run says so, through its tag or an explicit `claim`; otherwise an
# overlapping run that started the same browser or dev server later would be inside
# this run's kill set.
owned_set() {
  { cat "$STATE_DIR/claimed.txt" 2>/dev/null; claimed_descendants; } \
    | grep -E '^[0-9]+$' | sort -u
}

# Children of a claimed process are still work this run started.
claimed_descendants() {
  [ -s "$STATE_DIR/claimed.txt" ] || return 0
  ps -Ao pid=,ppid= 2>/dev/null | awk '
    NR == FNR { own[$1] = 1; next }
    { parent[$1] = $2 }
    END {
      for (p in parent) {
        q = p
        for (d = 0; d < 64; d++) {
          q = parent[q] + 0
          if (q <= 1) break
          if (q in own) { print p; break }
        }
      }
    }' "$STATE_DIR/claimed.txt" -
}

is_owned() {  # $1 pid, $2 command line, $3 newline-separated owned set
  if [ -n "$RUN_TAG" ]; then
    case "$2" in *"$RUN_TAG"*) return 0 ;; esac
  fi
  printf '%s\n' "$3" | grep -qxF "$1" && return 0
  return 1
}

stop_owned() {  # $1 group name, $2 pattern, $3 newline-separated owned set
  local name="$1" pattern="$2" owned="$3" pid cmdline line ts
  local signaled=()
  ts="$(date +%s)"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    pid="${line%% *}"; cmdline="${line#* }"
    is_owned "$pid" "$cmdline" "$owned" || continue
    kill -TERM "$pid" 2>/dev/null || continue
    signaled+=("$pid")
    printf '{"ts":%s,"event":"stop-owned","group":"%s","pid":%s,"signal":"TERM"}\n' "$ts" "$name" "$pid" >> "$STATE_DIR/events.jsonl"
  done < <(ps -Ao pid=,rss=,command= 2>/dev/null | grep -E -e "$pattern" | grep -vF 'resource-guard.sh' | awk '{ pid=$1; $1=""; $2=""; sub(/^ +/,""); print pid " " $0 }')
  [ "${#signaled[@]}" -gt 0 ] || return 0
  sleep "$GRACE"
  for pid in "${signaled[@]}"; do
    kill -0 "$pid" 2>/dev/null || continue
    kill -KILL "$pid" 2>/dev/null || continue
    printf '{"ts":%s,"event":"stop-owned","group":"%s","pid":%s,"signal":"KILL"}\n' "$ts" "$name" "$pid" >> "$STATE_DIR/events.jsonl"
  done
  return 0
}

watch_loop() {
  local plat sample tier
  plat="$(platform_name)"
  case "$plat" in Darwin|Linux) ;; *) fail "Unsupported platform: $plat" ;; esac
  load_config
  while [ -f "$STATE_DIR/guard.pid" ]; do
    sample="$(emit_sample "$GROUP_SPECS" "$YELLOW" "$RED")"
    printf '%s\n' "$sample" >> "$STATE_DIR/samples.jsonl"
    tier="$(tier_of "$sample")"
    if [ "$tier" = red ] && [ "$ON_RED" = stop-owned ]; then
      printf '{"ts":%s,"event":"tier","tier":"red","action":"stop-owned"}\n' "$(date +%s)" >> "$STATE_DIR/events.jsonl"
      local line name pattern owned
      owned="$(owned_set)"
      while IFS= read -r line; do
        [ -n "$line" ] || continue
        name="${line%%=*}"; pattern="${line#*=}"
        stop_owned "$name" "$pattern" "$owned"
      done <<< "$GROUP_SPECS"
    elif [ "$tier" != green ]; then
      printf '{"ts":%s,"event":"tier","tier":"%s","action":"none"}\n' "$(date +%s)" "$tier" >> "$STATE_DIR/events.jsonl"
    fi
    sleep "$INTERVAL"
  done
}

do_start() {
  [ -n "$STATE_DIR" ] || fail "start needs --state-dir"
  mkdir -p "$STATE_DIR" || fail "cannot create state dir: $STATE_DIR"
  write_config
  : > "$STATE_DIR/samples.jsonl"
  : > "$STATE_DIR/events.jsonl"
  rm -f "$STATE_DIR/claimed.txt"
  nohup bash "$0" __watch --state-dir "$STATE_DIR" >/dev/null 2>&1 &
  echo $! > "$STATE_DIR/guard.pid"
  printf '%s started (pid %s) state-dir=%s\n' "$PROG" "$(cat "$STATE_DIR/guard.pid")" "$STATE_DIR"
}

# Register processes this run started, so stop-owned can prove they are ours even
# when their command line cannot carry the run tag (a browser daemon, a dev server).
do_claim() {
  [ -n "$STATE_DIR" ] || fail "claim needs --state-dir"
  [ -n "$PIDS" ] || fail "claim needs at least one --pid"
  mkdir -p "$STATE_DIR" || fail "cannot create state dir: $STATE_DIR"
  local pid added=0
  : >> "$STATE_DIR/claimed.txt"
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    case "$pid" in *[!0-9]*) fail "claim needs numeric pids, got: $pid" ;; esac
    grep -qxF "$pid" "$STATE_DIR/claimed.txt" 2>/dev/null && continue
    printf '%s\n' "$pid" >> "$STATE_DIR/claimed.txt"
    added=$((added + 1))
  done <<< "$PIDS"
  printf '%s claimed %s pid(s)\n' "$PROG" "$added"
}

do_stop() {
  [ -n "$STATE_DIR" ] || fail "stop needs --state-dir"
  [ -f "$STATE_DIR/guard.pid" ] || { echo "$PROG not running"; exit 0; }
  local pid
  pid="$(cat "$STATE_DIR/guard.pid" 2>/dev/null)"
  rm -f "$STATE_DIR/guard.pid"
  [ -n "$pid" ] && kill "$pid" 2>/dev/null
  echo "$PROG stopped"
}

do_status() {
  [ -n "$STATE_DIR" ] || fail "status needs --state-dir"
  local last events y r total running
  last="$(tail -n 1 "$STATE_DIR/samples.jsonl" 2>/dev/null)"
  total="$(count_lines "$STATE_DIR/samples.jsonl")"
  events="$(count_lines "$STATE_DIR/events.jsonl")"
  y="$(count_match '"tier":"yellow"' "$STATE_DIR/samples.jsonl")"
  r="$(count_match '"tier":"red"' "$STATE_DIR/samples.jsonl")"
  running=no; [ -f "$STATE_DIR/guard.pid" ] && running=yes
  if [ "$JSON" = 1 ]; then
    printf '{"running":%s,"samples":%s,"yellow":%s,"red":%s,"events":%s,"last":%s}\n' \
      "$([ "$running" = yes ] && echo true || echo false)" "$total" "$y" "$r" "$events" "${last:-null}"
  else
    printf '%s running=%s samples=%s yellow=%s red=%s events=%s\n' \
      "$PROG" "$running" "$total" "$y" "$r" "$events"
    [ -n "$last" ] && printf '%s\n' "$last"
  fi
}

case "$MODE" in
  check)  do_check ;;
  start)  do_start ;;
  claim)  do_claim ;;
  stop)   do_stop ;;
  status) do_status ;;
  __watch) [ -n "$STATE_DIR" ] || fail "__watch needs --state-dir"; watch_loop ;;
esac
