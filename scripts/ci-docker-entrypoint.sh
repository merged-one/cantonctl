#!/usr/bin/env bash

set -euo pipefail

TARGET="${1:-required}"

exec node /app/scripts/ci/run.js inside "${TARGET}"
