#!/usr/bin/env bash

set -euo pipefail

MODE="docker"
TARGET="required"

if [[ "${1:-}" == "--docker" ]]; then
  MODE="docker"
  shift
elif [[ "${1:-}" == "--native" ]]; then
  MODE="native"
  shift
elif [[ "${1:-}" == "docker" || "${1:-}" == "native" ]]; then
  MODE="${1}"
  shift
fi

if [[ -n "${1:-}" ]]; then
  TARGET="${1}"
fi

exec node scripts/ci/run.js "${MODE}" "${TARGET}"
