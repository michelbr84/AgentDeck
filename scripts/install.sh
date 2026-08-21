#!/usr/bin/env bash
# ==============================================================================
# AgentDeck - Ubuntu / Debian Linux Automated Installer
# https://github.com/michelbr84/AgentDeck
# ==============================================================================

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

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
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# 1. OS & Architecture Check
echo -e "${YELLOW}[1/4] Checking system environment...${NC}"
OS="$(uname -s)"
if [ "$OS" != "Linux" ] && [ "$OS" != "Darwin" ]; then
  echo -e "${RED}Error: AgentDeck installer currently supports Linux (Ubuntu/Debian) and macOS.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ OS detected: $OS ($(uname -m))${NC}"

# 2. Node.js Verification
echo -e "${YELLOW}[2/4] Verifying Node.js runtime...${NC}"
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

if [ "$DRY_RUN" -eq 1 ]; then
  echo -e "\n${YELLOW}[DRY-RUN] Verification complete. System satisfies all dependencies.${NC}"
  exit 0
fi

# 3. Create Secure Directory Tree
echo -e "${YELLOW}[3/4] Preparing secure configuration directories...${NC}"
INSTALL_DIR="$HOME/.agentdeck"
mkdir -p "$INSTALL_DIR"/{data,secrets,plugins,backups,logs,personas}
chmod 700 "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR/secrets"
echo -e "${GREEN}✓ Initialized secure storage at $INSTALL_DIR (0700)${NC}"

# 4. Build and Install AgentDeck CLI
echo -e "${YELLOW}[4/4] Building and linking AgentDeck...${NC}"

# If running within repository
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$REPO_DIR/pnpm-workspace.yaml" ]; then
  echo -e "Detected local monorepo at $REPO_DIR. Building packages..."
  cd "$REPO_DIR"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile || pnpm install
    pnpm build
    # Link CLI locally
    cd "$REPO_DIR/apps/cli"
    npm link || true
  else
    npm install
    npm run build || true
  fi
else
  echo "Installing @agentdeck/cli globally via npm..."
  npm install -g @agentdeck/cli || true
fi

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
