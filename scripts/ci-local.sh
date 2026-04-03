#!/usr/bin/env bash
#
# ci-local.sh — Run the same checks that GitHub Actions CI runs.
#
# This script mirrors the CI workflow (.github/workflows/ci.yml) so that
# passing locally guarantees passing on GitHub Actions.
#
# Usage:
#   ./scripts/ci-local.sh                  # native: required PR gate
#   ./scripts/ci-local.sh required         # native: unit + specs + sdk + stable-public + sandbox
#   ./scripts/ci-local.sh unit             # native: unit tests only
#   ./scripts/ci-local.sh generated-specs  # native: generated spec verification only
#   ./scripts/ci-local.sh e2e-sdk          # native: SDK E2E only
#   ./scripts/ci-local.sh e2e-stable-public # native: stable/public E2E only
#   ./scripts/ci-local.sh e2e-sandbox      # native: sandbox E2E only
#   ./scripts/ci-local.sh e2e-experimental # native: experimental E2E only
#   ./scripts/ci-local.sh all              # native: required gate + experimental + docker
#   ./scripts/ci-local.sh --docker         # Docker: full CI in ubuntu container
#   ./scripts/ci-local.sh --docker unit    # Docker: unit tests only
#   ./scripts/ci-local.sh --docker generated-specs
#   ./scripts/ci-local.sh --docker e2e-sdk # Docker: SDK E2E only
#   ./scripts/ci-local.sh --docker e2e-stable-public
#
# The --docker flag runs tests inside a container that exactly matches the
# GitHub Actions runner (ubuntu + Node 22 + Java 21 + Daml SDK 3.4.11).
# This eliminates macOS-vs-Linux differences and is the gold standard for
# "will this pass CI?"

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

# ---------------------------------------------------------------------------
# Docker mode: delegate to docker compose
# ---------------------------------------------------------------------------

if [[ "${1:-}" == "--docker" ]]; then
  shift
  MODE="${1:-required}"
  echo -e "${BOLD}==> Running CI in Docker (matches GitHub Actions exactly)${RESET}"
  echo ""
  docker compose -f docker-compose.ci.yml build ci
  docker compose -f docker-compose.ci.yml run --rm ci "$MODE"
  exit $?
fi

# ---------------------------------------------------------------------------
# Native mode: run directly on the host
# ---------------------------------------------------------------------------

passed=0
failed=0
skipped=0

step() { echo ""; echo -e "${BOLD}==> $1${RESET}"; }
pass() { echo -e "  ${GREEN}PASS${RESET} $1"; ((passed++)) || true; }
fail() { echo -e "  ${RED}FAIL${RESET} $1"; ((failed++)) || true; }
skip() { echo -e "  ${YELLOW}SKIP${RESET} $1"; ((skipped++)) || true; }

run_step() {
  local label="$1"; shift
  local output rc=0
  output=$("$@" 2>&1) || rc=$?
  if (( rc == 0 )); then
    echo "$output" | tail -5
    pass "$label"
  else
    echo "$output" | tail -20
    fail "$label"
  fi
  return $rc
}

# Environment
step "Environment"
echo "  Node:    $(node --version)"
echo "  npm:     $(npm --version)"
echo "  OS:      $(uname -s) $(uname -m)"

NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if (( NODE_MAJOR < 18 )); then
  echo -e "  ${RED}ERROR: Node 18+ required (CI tests 18, 20, 22). Got Node $NODE_MAJOR.${RESET}"
  exit 1
fi

HAS_DAML=false
if command -v daml &>/dev/null || [ -f "$HOME/.daml/bin/daml" ]; then
  HAS_DAML=true
  echo "  Daml:    available"
fi

HAS_JAVA=false
# Detect Java via the same resolution order as createProcessRunner():
#   1. JAVA_HOME/bin/java
#   2. Homebrew openjdk@21 (macOS ARM + Intel)
#   3. System PATH (but verify it's real, not the macOS stub)
JAVA_BIN=""
if [ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  JAVA_BIN="$JAVA_HOME/bin/java"
elif [ -x "/opt/homebrew/opt/openjdk@21/bin/java" ]; then
  JAVA_BIN="/opt/homebrew/opt/openjdk@21/bin/java"
elif [ -x "/usr/local/opt/openjdk@21/bin/java" ]; then
  JAVA_BIN="/usr/local/opt/openjdk@21/bin/java"
elif command -v java &>/dev/null && java -version &>/dev/null 2>&1; then
  JAVA_BIN="java"
fi

if [ -n "$JAVA_BIN" ]; then
  HAS_JAVA=true
  echo "  Java:    $($JAVA_BIN -version 2>&1 | head -1)"
fi

# Docker detection (for e2e-docker tests)
HAS_DOCKER=false
if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
  HAS_DOCKER=true
  echo "  Docker:  available ($(docker compose version 2>&1 | head -1))"
fi

# What to run
MODE="${1:-required}"
RUN_UNIT=false
RUN_GENERATED_SPECS=false
RUN_E2E_SDK=false
RUN_E2E_STABLE_PUBLIC=false
RUN_E2E_SANDBOX=false
RUN_E2E_DOCKER=false
RUN_E2E_EXPERIMENTAL=false

case "$MODE" in
  unit)        RUN_UNIT=true ;;
  generated-specs) RUN_GENERATED_SPECS=true ;;
  e2e)         RUN_E2E_SDK=true; RUN_E2E_STABLE_PUBLIC=true; RUN_E2E_SANDBOX=true ;;
  e2e-sdk)     RUN_E2E_SDK=true ;;
  e2e-stable-public) RUN_E2E_STABLE_PUBLIC=true ;;
  e2e-sandbox) RUN_E2E_SANDBOX=true ;;
  e2e-experimental) RUN_E2E_EXPERIMENTAL=true ;;
  e2e-docker)  RUN_E2E_DOCKER=true ;;
  required)    RUN_UNIT=true; RUN_GENERATED_SPECS=true; RUN_E2E_SDK=true; RUN_E2E_STABLE_PUBLIC=true; RUN_E2E_SANDBOX=true ;;
  all)         RUN_UNIT=true; RUN_GENERATED_SPECS=true; RUN_E2E_SDK=true; RUN_E2E_STABLE_PUBLIC=true; RUN_E2E_SANDBOX=true; RUN_E2E_EXPERIMENTAL=true; RUN_E2E_DOCKER=true ;;
  *)           echo "Usage: $0 [--docker] [required|unit|generated-specs|e2e|e2e-sdk|e2e-stable-public|e2e-sandbox|e2e-experimental|e2e-docker|all]"; exit 1 ;;
esac

# Install + build (matches CI)
step "Install dependencies (npm ci)"
npm ci --silent 2>&1 || { echo -e "${RED}npm ci failed${RESET}"; exit 1; }

step "Build TypeScript"
if ! run_step "tsc build" npm run build; then
  echo -e "${RED}Build failed — cannot continue.${RESET}"
  exit 1
fi

# Unit tests
if $RUN_UNIT; then
  step "Unit tests (CI: unit-tests matrix on Node 18/20/22)"
  run_step "unit tests (Node $NODE_MAJOR)" npm test || true
else
  skip "unit tests (not selected)"
fi

# Generated specs tests
if $RUN_GENERATED_SPECS; then
  step "Generated spec verification (CI: generated-spec-tests)"
  run_step "generated spec tests" npm run test:generated-specs || true
else
  skip "generated spec tests (not selected)"
fi

# E2E SDK tests
if $RUN_E2E_SDK; then
  step "E2E SDK tests (CI: e2e-sdk-tests)"
  if ! $HAS_DAML || ! $HAS_JAVA; then
    skip "e2e-sdk (requires Daml SDK + Java 21 — use --docker for full parity)"
  else
    run_step "e2e-sdk tests" npm run test:e2e:sdk || true
  fi
else
  skip "e2e-sdk tests (not selected)"
fi

# Stable/public E2E tests
if $RUN_E2E_STABLE_PUBLIC; then
  step "Stable/public E2E tests (CI: e2e-stable-public-tests)"
  run_step "e2e-stable-public tests" npm run test:e2e:stable-public || true
else
  skip "e2e-stable-public tests (not selected)"
fi

# E2E sandbox tests
if $RUN_E2E_SANDBOX; then
  step "E2E sandbox tests (CI: e2e-sandbox-tests)"
  if ! $HAS_DAML || ! $HAS_JAVA; then
    skip "e2e-sandbox (requires Daml SDK + Java 21 — use --docker for full parity)"
  else
    JAVA_OPTS="-Xms512M -Xmx2G -XX:+UseSerialGC" \
      run_step "e2e-sandbox tests" npm run test:e2e:sandbox || true
  fi
else
  skip "e2e-sandbox tests (not selected)"
fi

# Experimental E2E tests
if $RUN_E2E_EXPERIMENTAL; then
  step "Experimental E2E tests (non-blocking CI job)"
  run_step "e2e-experimental tests" npm run test:e2e:experimental || true
else
  skip "e2e-experimental tests (not selected)"
fi

# E2E Docker tests
if $RUN_E2E_DOCKER; then
  step "E2E Docker tests (CI: e2e-docker-tests)"
  if ! $HAS_DAML || ! $HAS_JAVA; then
    skip "e2e-docker (requires Daml SDK + Java 21)"
  elif ! $HAS_DOCKER; then
    skip "e2e-docker (requires Docker + Docker Compose)"
  else
    run_step "e2e-docker tests" npm run test:e2e:docker || true
  fi
else
  skip "e2e-docker tests (not selected)"
fi

# Summary
step "Results"
echo -e "  ${GREEN}Passed: $passed${RESET}"
(( failed > 0 )) && echo -e "  ${RED}Failed: $failed${RESET}"
(( skipped > 0 )) && echo -e "  ${YELLOW}Skipped: $skipped${RESET}"

echo ""
if (( failed > 0 )); then
  echo -e "${RED}${BOLD}CI check failed — do not push.${RESET}"
  exit 1
elif (( skipped > 0 )); then
  echo -e "${YELLOW}${BOLD}CI check passed (with skips — use --docker for full parity).${RESET}"
else
  echo -e "${GREEN}${BOLD}CI check passed — safe to push.${RESET}"
fi
