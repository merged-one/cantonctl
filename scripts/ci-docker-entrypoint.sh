#!/usr/bin/env bash
#
# ci-docker-entrypoint.sh — Runs inside the CI Docker container.
# Executes the exact same steps as .github/workflows/ci.yml.
#
# Usage (via docker run):
#   all          - unit + e2e-sdk + e2e-sandbox
#   unit         - unit tests only
#   e2e-sdk      - SDK E2E tests only
#   e2e-sandbox  - sandbox E2E tests only
#   e2e          - all E2E tests
#   shell        - drop into bash for debugging

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

MODE="${1:-all}"

# Drop to shell for debugging
if [[ "$MODE" == "shell" ]]; then
  exec bash
fi

passed=0
failed=0

step() { echo -e "\n${BOLD}==> $1${RESET}"; }
pass() { echo -e "  ${GREEN}PASS${RESET} $1"; ((passed++)) || true; }
fail() { echo -e "  ${RED}FAIL${RESET} $1"; ((failed++)) || true; }

run_step() {
  local label="$1"; shift
  local output rc=0
  output=$("$@" 2>&1) || rc=$?
  if (( rc == 0 )); then
    echo "$output" | tail -5
    pass "$label"
  else
    echo "$output" | tail -25
    fail "$label"
  fi
  return $rc
}

# ---------------------------------------------------------------------------
# Environment report
# ---------------------------------------------------------------------------

step "CI Environment (Docker)"
echo "  Node:    $(node --version)"
echo "  npm:     $(npm --version)"
echo "  Java:    $(java -version 2>&1 | head -1)"
echo "  Daml:    $(daml version --no-legacy-assistant-warning 2>/dev/null | grep -m1 'SDK\|[0-9]' || echo 'available')"
echo "  OS:      $(uname -s) $(uname -m)"
echo "  Mode:    $MODE"

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

RUN_UNIT=false; RUN_SDK=false; RUN_SANDBOX=false

case "$MODE" in
  unit)        RUN_UNIT=true ;;
  e2e-sdk)     RUN_SDK=true ;;
  e2e-sandbox) RUN_SANDBOX=true ;;
  e2e)         RUN_SDK=true; RUN_SANDBOX=true ;;
  all)         RUN_UNIT=true; RUN_SDK=true; RUN_SANDBOX=true ;;
  *)           echo "Usage: $0 [all|unit|e2e|e2e-sdk|e2e-sandbox|shell]"; exit 1 ;;
esac

if $RUN_UNIT; then
  step "Unit tests (CI: unit-tests)"
  run_step "unit tests (Node $(node --version | sed 's/v//'))" npm test || true
fi

if $RUN_SDK; then
  step "E2E SDK tests (CI: e2e-sdk-tests)"
  run_step "e2e-sdk tests" npm run test:e2e:sdk || true
fi

if $RUN_SANDBOX; then
  step "E2E sandbox tests (CI: e2e-sandbox-tests)"
  JAVA_OPTS="-Xms512M -Xmx2G -XX:+UseSerialGC" \
    run_step "e2e-sandbox tests" npm run test:e2e:sandbox || true
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

step "Results"
echo -e "  ${GREEN}Passed: $passed${RESET}"
if (( failed > 0 )); then
  echo -e "  ${RED}Failed: $failed${RESET}"
  echo ""
  echo -e "${RED}${BOLD}CI check failed.${RESET}"
  exit 1
fi
echo ""
echo -e "${GREEN}${BOLD}CI check passed — matches GitHub Actions.${RESET}"
