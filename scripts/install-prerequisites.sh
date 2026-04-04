#!/usr/bin/env bash
# install-prerequisites.sh — Install all prerequisites for cantonctl development and E2E testing
#
# Usage:
#   ./scripts/install-prerequisites.sh          # Install everything
#   ./scripts/install-prerequisites.sh --check   # Check what's installed without installing
#
# Prerequisites:
#   - macOS with Homebrew (or Linux with apt/dnf)
#   - Node.js 18+ (for cantonctl itself)
#   - Java 21+ (for Canton sandbox)
#   - DPM 3.4.x toolchain (current Canton/Daml CLI)

set -euo pipefail

JAVA_VERSION="${JAVA_VERSION:-21}"
CHECK_ONLY="${1:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }

echo "cantonctl prerequisites check"
echo "=============================="
echo ""

MISSING=0

# Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    ok "Node.js $NODE_VER"
  else
    fail "Node.js $NODE_VER (need ≥18)"
    MISSING=$((MISSING + 1))
  fi
else
  fail "Node.js not found"
  MISSING=$((MISSING + 1))
fi

# Java
if command -v java &>/dev/null; then
  JAVA_VER=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | cut -d. -f1)
  if [ "$JAVA_VER" -ge "$JAVA_VERSION" ]; then
    ok "Java $JAVA_VER"
  else
    fail "Java $JAVA_VER (need ≥$JAVA_VERSION)"
    MISSING=$((MISSING + 1))
  fi
elif [ -x "/opt/homebrew/opt/openjdk@$JAVA_VERSION/bin/java" ]; then
  ok "Java $JAVA_VERSION (Homebrew, needs PATH)"
  warn "  Add to PATH: export PATH=\"/opt/homebrew/opt/openjdk@$JAVA_VERSION/bin:\$PATH\""
else
  fail "Java not found"
  MISSING=$((MISSING + 1))
fi

# DPM (current CLI)
if command -v dpm &>/dev/null; then
  ok "DPM (current Canton Package Manager)"
elif [ -x "$HOME/.dpm/bin/dpm" ]; then
  ok "DPM (~/.dpm/bin/dpm, needs PATH)"
  warn "  Add to PATH: export PATH=\"\$HOME/.dpm/bin:\$PATH\""
else
  fail "DPM not found"
  MISSING=$((MISSING + 1))
fi

# daml (legacy fallback only)
if command -v daml &>/dev/null; then
  warn "Legacy daml CLI detected (kept only for older Canton 3.3 projects)"
elif [ -x "$HOME/.daml/bin/daml" ]; then
  warn "Legacy daml CLI available at ~/.daml/bin/daml (kept only for older Canton 3.3 projects)"
fi

# Git
if command -v git &>/dev/null; then
  ok "Git $(git --version | cut -d' ' -f3)"
else
  fail "Git not found"
  MISSING=$((MISSING + 1))
fi

echo ""

if [ "$CHECK_ONLY" = "--check" ]; then
  if [ "$MISSING" -gt 0 ]; then
    echo "$MISSING prerequisite(s) missing. Run without --check to install."
    exit 1
  else
    echo "All prerequisites installed."
    exit 0
  fi
fi

if [ "$MISSING" -eq 0 ]; then
  echo "All prerequisites already installed."
  exit 0
fi

echo "Installing missing prerequisites..."
echo ""

# Install Java via Homebrew (macOS)
if ! command -v java &>/dev/null && [ ! -x "/opt/homebrew/opt/openjdk@$JAVA_VERSION/bin/java" ]; then
  if command -v brew &>/dev/null; then
    echo "Installing OpenJDK $JAVA_VERSION via Homebrew..."
    brew install "openjdk@$JAVA_VERSION"
    ok "Java $JAVA_VERSION installed"
  else
    fail "Cannot install Java — Homebrew not found. Install manually: https://adoptium.net/"
    exit 1
  fi
fi

# Install DPM
if ! command -v dpm &>/dev/null && [ ! -x "$HOME/.dpm/bin/dpm" ]; then
  echo "Installing DPM..."
  curl -fsSL https://get.digitalasset.com/install/install.sh | sh
  ok "DPM installed to \$HOME/.dpm"
fi

echo ""
echo "Add these to your shell profile (~/.zshrc or ~/.bashrc):"
echo ""
echo "  export PATH=\"/opt/homebrew/opt/openjdk@$JAVA_VERSION/bin:\$HOME/.dpm/bin:\$PATH\""
echo ""
echo "Then run: source ~/.zshrc && ./scripts/install-prerequisites.sh --check"
