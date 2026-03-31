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
#   - Daml SDK 3.4.x (for Daml compilation and sandbox)

set -euo pipefail

DAML_VERSION="${DAML_VERSION:-3.4.11}"
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

# Daml SDK
if command -v daml &>/dev/null; then
  ok "Daml SDK (daml on PATH)"
elif [ -x "$HOME/.daml/bin/daml" ]; then
  ok "Daml SDK (~/.daml/bin/daml, needs PATH)"
  warn "  Add to PATH: export PATH=\"\$HOME/.daml/bin:\$PATH\""
else
  fail "Daml SDK not found"
  MISSING=$((MISSING + 1))
fi

# dpm (optional, preferred over daml)
if command -v dpm &>/dev/null; then
  ok "dpm (Canton Package Manager)"
else
  warn "dpm not found (optional — daml CLI will be used as fallback)"
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

# Install Daml SDK
if ! command -v daml &>/dev/null && [ ! -x "$HOME/.daml/bin/daml" ]; then
  echo "Installing Daml SDK $DAML_VERSION..."
  PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="x86_64"  # Daml SDK only ships x86_64, uses Rosetta on ARM Macs

  RELEASE_URL="https://github.com/digital-asset/daml/releases/download/v${DAML_VERSION}/daml-sdk-${DAML_VERSION}-${PLATFORM}-${ARCH}.tar.gz"

  TMPDIR=$(mktemp -d)
  curl -sSL "$RELEASE_URL" -o "$TMPDIR/daml-sdk.tar.gz"
  cd "$TMPDIR" && tar xzf daml-sdk.tar.gz

  DAML_HOME="$HOME/.daml"
  mkdir -p "$DAML_HOME/sdk/$DAML_VERSION" "$DAML_HOME/bin"
  cp -r "$TMPDIR/sdk-$DAML_VERSION/"* "$DAML_HOME/sdk/$DAML_VERSION/"
  ln -sf "$DAML_HOME/sdk/$DAML_VERSION/daml/daml" "$DAML_HOME/bin/daml"
  echo "$DAML_VERSION" > "$DAML_HOME/sdk/default"

  rm -rf "$TMPDIR"
  ok "Daml SDK $DAML_VERSION installed to $DAML_HOME"
fi

echo ""
echo "Add these to your shell profile (~/.zshrc or ~/.bashrc):"
echo ""
echo "  export PATH=\"/opt/homebrew/opt/openjdk@$JAVA_VERSION/bin:\$HOME/.daml/bin:\$PATH\""
echo ""
echo "Then run: source ~/.zshrc && ./scripts/install-prerequisites.sh --check"
