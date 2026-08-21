#!/usr/bin/env bash
# ==============================================================================
# AgentDeck - Checksum Generation & Release Packaging Script
# https://github.com/michelbr84/AgentDeck
# ==============================================================================

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist-release"

echo -e "${CYAN}=== Building AgentDeck Release Artifacts ===${NC}\n"

cd "$ROOT_DIR"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

echo -e "${YELLOW}Building all monorepo packages...${NC}"
pnpm build

echo -e "${YELLOW}Packaging CLI bundle...${NC}"
tar -czf "$DIST_DIR/agentdeck-cli.tar.gz" -C "$ROOT_DIR/apps/cli" package.json dist

echo -e "${YELLOW}Packaging Web bundle...${NC}"
tar -czf "$DIST_DIR/agentdeck-web.tar.gz" -C "$ROOT_DIR/apps/web" package.json dist

echo -e "${YELLOW}Generating SHA256 checksums...${NC}"
cd "$DIST_DIR"
sha256sum agentdeck-cli.tar.gz agentdeck-web.tar.gz > checksums.txt

echo -e "\n${GREEN}✔ Release artifacts generated successfully:${NC}"
ls -lh "$DIST_DIR"
cat "$DIST_DIR/checksums.txt"
