#!/usr/bin/env bash
# ==============================================================================
# AgentDeck - Development Bootstrap Script
# https://github.com/michelbr84/AgentDeck
# ==============================================================================

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "${CYAN}=== Setting up AgentDeck Development Environment ===${NC}\n"

cd "$ROOT_DIR"

echo -e "${YELLOW}[1/4] Installing dependencies...${NC}"
pnpm install

echo -e "${YELLOW}[2/4] Building all packages in dependency order...${NC}"
pnpm build

echo -e "${YELLOW}[3/4] Running automated test suites...${NC}"
pnpm test

echo -e "${YELLOW}[4/4] Linking CLI locally...${NC}"
cd "$ROOT_DIR/apps/cli"
npm link || true

echo -e "\n${GREEN}✔ Development environment is ready!${NC}"
echo -e "You can now run ${CYAN}agentdeck --help${NC} directly."
