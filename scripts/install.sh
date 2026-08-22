#!/usr/bin/env bash
# ==============================================================================
# AgentDeck - Ubuntu / Debian Linux & macOS Automated Installer
# https://github.com/michelbr84/AgentDeck
# ==============================================================================

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

REPO="michelbr84/AgentDeck"
FALLBACK_VERSION="v1.0.4"

echo -e "${CYAN}"
echo "  █████╗  ██████╗ ███████╗███╗   ██╗████████╗██████╗ ███████╗ ██████╗██╗  ██╗"
echo " ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██╔════╝██╔════╝██║ ██╔╝"
echo " ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║  ██║█████╗  ██║     █████╔╝ "
echo " ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║  ██║██╔══╝  ██║     ██╔═██╗ "
echo " ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██████╔╝███████╗╚██████╗██║  ██╗"
echo " ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝"
echo -e "${NC}"
echo -e "${CYAN}=== Multi-Agent Management Deck & Orchestration Platform ===${NC}\n"

# Parse flags
DRY_RUN=0
TARGET_VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --version)
      TARGET_VERSION="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# 1. OS & Architecture Check
echo -e "${YELLOW}[1/5] Checking system environment...${NC}"
OS="$(uname -s)"
if [ "$OS" != "Linux" ] && [ "$OS" != "Darwin" ]; then
  echo -e "${RED}Error: AgentDeck installer supports Linux (Ubuntu/Debian) and macOS.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ OS detected: $OS ($(uname -m))${NC}"

# 2. Node.js Verification
echo -e "${YELLOW}[2/5] Verifying Node.js runtime...${NC}"
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Error: Node.js is not installed. Please install Node.js 20+ LTS before proceeding.${NC}"
  echo -e "You can install Node.js via: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 20 ]; then
  echo -e "${RED}Error: Node.js version $NODE_VER is older than required Node.js 20 LTS.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v) is ready${NC}"

# Verify essential utilities
for util in curl tar cp; do
  if ! command -v "$util" >/dev/null 2>&1; then
    echo -e "${RED}Error: Required utility '$util' is not installed.${NC}"
    exit 1
  fi
done

if [ "$DRY_RUN" -eq 1 ]; then
  echo -e "\n${YELLOW}[DRY-RUN] Verification complete. System satisfies all dependencies.${NC}"
  exit 0
fi

# 3. Create Secure Directory Tree
echo -e "${YELLOW}[3/5] Preparing secure configuration directories...${NC}"
AGENTDECK_HOME="$HOME/.agentdeck"
mkdir -p "$AGENTDECK_HOME"/{bin,app,data,secrets,plugins,backups,logs,personas}
chmod 700 "$AGENTDECK_HOME"
chmod 700 "$AGENTDECK_HOME/secrets"
echo -e "${GREEN}✓ Initialized secure storage at $AGENTDECK_HOME (0700)${NC}"

# 4. Resolve and Download Release Artifacts
echo -e "${YELLOW}[4/5] Installing AgentDeck CLI...${NC}"

# Remote release install via GitHub Releases
echo "Resolving AgentDeck release from GitHub (${REPO})..."

if [ -n "$TARGET_VERSION" ]; then
  VERSION="$TARGET_VERSION"
else
  LATEST_JSON=$(curl -fsSL -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null || true)
  if [ -n "$LATEST_JSON" ]; then
    RESOLVED_TAG=$(echo "$LATEST_JSON" | grep -o '"tag_name": "[^"]*"' | head -1 | cut -d'"' -f4 || true)
    VERSION="${RESOLVED_TAG:-$FALLBACK_VERSION}"
  else
    VERSION="$FALLBACK_VERSION"
  fi
fi

echo -e "Target version: ${CYAN}${VERSION}${NC}"

TMP_DIR="$(mktemp -d /tmp/agentdeck-install-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

DOWNLOAD_BASE="https://github.com/${REPO}/releases/download/${VERSION}"
CLI_TARBALL_URL="${DOWNLOAD_BASE}/agentdeck-cli.tar.gz"
WEB_TARBALL_URL="${DOWNLOAD_BASE}/agentdeck-web.tar.gz"
CHECKSUMS_URL="${DOWNLOAD_BASE}/checksums.txt"

echo "Downloading ${CLI_TARBALL_URL}..."
curl -fsSL -o "$TMP_DIR/agentdeck-cli.tar.gz" "$CLI_TARBALL_URL"

echo "Downloading ${WEB_TARBALL_URL}..."
curl -fsSL -o "$TMP_DIR/agentdeck-web.tar.gz" "$WEB_TARBALL_URL"

echo "Downloading ${CHECKSUMS_URL}..."
curl -fsSL -o "$TMP_DIR/checksums.txt" "$CHECKSUMS_URL"

echo "Verifying SHA-256 checksums..."
cd "$TMP_DIR"
EXPECTED_CLI_HASH=$(grep "agentdeck-cli.tar.gz" checksums.txt | awk '{print $1}')
EXPECTED_WEB_HASH=$(grep "agentdeck-web.tar.gz" checksums.txt | awk '{print $1}')

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_CLI_HASH=$(sha256sum agentdeck-cli.tar.gz | awk '{print $1}')
  ACTUAL_WEB_HASH=$(sha256sum agentdeck-web.tar.gz | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_CLI_HASH=$(shasum -a 256 agentdeck-cli.tar.gz | awk '{print $1}')
  ACTUAL_WEB_HASH=$(shasum -a 256 agentdeck-web.tar.gz | awk '{print $1}')
else
  echo -e "${RED}Error: Neither sha256sum nor shasum is available for checksum verification.${NC}"
  exit 1
fi

if [ -z "$EXPECTED_CLI_HASH" ] || [ "$EXPECTED_CLI_HASH" != "$ACTUAL_CLI_HASH" ]; then
  echo -e "${RED}Error: CLI SHA-256 checksum mismatch!${NC}"
  echo -e "Expected: $EXPECTED_CLI_HASH"
  echo -e "Actual:   $ACTUAL_CLI_HASH"
  exit 1
fi

if [ -z "$EXPECTED_WEB_HASH" ] || [ "$EXPECTED_WEB_HASH" != "$ACTUAL_WEB_HASH" ]; then
  echo -e "${RED}Error: Web SHA-256 checksum mismatch!${NC}"
  echo -e "Expected: $EXPECTED_WEB_HASH"
  echo -e "Actual:   $ACTUAL_WEB_HASH"
  exit 1
fi
echo -e "${GREEN}✓ Checksums verified successfully (CLI & Web Deck)${NC}"

APP_DIR="$AGENTDECK_HOME/app"
rm -rf "${APP_DIR:?}"/*
tar -xzf "$TMP_DIR/agentdeck-cli.tar.gz" -C "$APP_DIR"

mkdir -p "$APP_DIR/web"
tar -xzf "$TMP_DIR/agentdeck-web.tar.gz" -C "$APP_DIR/web"

echo "Installing production runtime dependencies..."
cd "$APP_DIR"
npm install --omit=dev --silent --no-audit --no-fund

# Copy internal bundled @agentdeck packages into node_modules
if [ -d "$APP_DIR/bundle_modules/@agentdeck" ]; then
  mkdir -p "$APP_DIR/node_modules/@agentdeck"
  cp -r "$APP_DIR"/bundle_modules/@agentdeck/* "$APP_DIR/node_modules/@agentdeck/"
fi

# Create executable wrapper script in ~/.agentdeck/bin and ~/.local/bin
WRAPPER_SCRIPT="$AGENTDECK_HOME/bin/agentdeck"
cat <<'EOF' > "$WRAPPER_SCRIPT"
#!/usr/bin/env bash
set -e
export NODE_ENV="${NODE_ENV:-production}"
exec node "$HOME/.agentdeck/app/dist/index.js" "$@"
EOF
chmod +x "$WRAPPER_SCRIPT"

# Link to standard user binary PATH (~/.local/bin)
USER_BIN_DIR="$HOME/.local/bin"
mkdir -p "$USER_BIN_DIR"
ln -sf "$WRAPPER_SCRIPT" "$USER_BIN_DIR/agentdeck"

# Ensure ~/.local/bin or ~/.agentdeck/bin is in PATH for current session
export PATH="$USER_BIN_DIR:$AGENTDECK_HOME/bin:$PATH"

# Add to shell RC files if not present
for RC_FILE in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  if [ -f "$RC_FILE" ]; then
    if ! grep -q '\.agentdeck/bin\|\.local/bin' "$RC_FILE"; then
      # shellcheck disable=SC2016
      echo 'export PATH="$HOME/.local/bin:$HOME/.agentdeck/bin:$PATH"' >> "$RC_FILE"
    fi
  fi
done

# 5. Verify Installation
echo -e "${YELLOW}[5/5] Verifying installed binary & web bundle...${NC}"

if ! command -v agentdeck >/dev/null 2>&1; then
  # Try explicit paths if PATH hasn't reloaded
  if [ -x "$HOME/.local/bin/agentdeck" ]; then
    export PATH="$HOME/.local/bin:$PATH"
  elif [ -x "$AGENTDECK_HOME/bin/agentdeck" ]; then
    export PATH="$AGENTDECK_HOME/bin:$PATH"
  fi
fi

if ! command -v agentdeck >/dev/null 2>&1; then
  echo -e "${RED}Error: 'agentdeck' executable not found in PATH or standard installation locations.${NC}"
  exit 1
fi

INSTALLED_VERSION=$(agentdeck --version 2>&1 || true)
if [ -z "$INSTALLED_VERSION" ] || [[ "$INSTALLED_VERSION" == *"Error"* ]] || [[ "$INSTALLED_VERSION" == *"Cannot find"* ]]; then
  echo -e "${RED}Error: Installed 'agentdeck' binary failed execution test: ${INSTALLED_VERSION}${NC}"
  exit 1
fi

# Verify Web Deck bundle
if [ ! -f "$APP_DIR/web/dist/index.html" ]; then
  echo -e "${RED}Error: Web Deck static bundle not found at $APP_DIR/web/dist/index.html${NC}"
  exit 1
fi

echo -e "${GREEN}✓ AgentDeck binary verified: version ${INSTALLED_VERSION}${NC}"
echo -e "${GREEN}✓ Web Deck static bundle verified: ready${NC}"

echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN}🎉 AgentDeck has been successfully installed!${NC}"
echo -e "${GREEN}======================================================${NC}\n"
echo -e "To start configuring your agents, run:"
echo -e "  ${CYAN}agentdeck setup${NC}\n"
echo -e "To launch the interactive terminal interface:"
echo -e "  ${CYAN}agentdeck tui${NC}\n"
echo -e "To start the web deck:"
echo -e "  ${CYAN}agentdeck web${NC}\n"
echo -e "For full documentation:"
echo -e "  ${CYAN}agentdeck docs${NC}\n"
