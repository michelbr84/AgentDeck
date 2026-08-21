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
BUNDLE_STAGE_DIR="$DIST_DIR/stage-cli"

echo -e "${CYAN}=== Building AgentDeck Release Artifacts ===${NC}\n"

cd "$ROOT_DIR"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR" "$BUNDLE_STAGE_DIR"

echo -e "${YELLOW}Building all monorepo packages...${NC}"
pnpm build

echo -e "${YELLOW}Packaging CLI bundle with monorepo internal packages...${NC}"

# 1. Copy CLI app
cp -r "$ROOT_DIR/apps/cli/dist" "$BUNDLE_STAGE_DIR/dist"

# Sanitize package.json for standalone consumption
node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("apps/cli/package.json", "utf8"));
const cleanedDeps = {};
for (const [k, v] of Object.entries(pkg.dependencies || {})) {
  if (!k.startsWith("@agentdeck/")) {
    cleanedDeps[k] = v;
  }
}
const extDeps = {
  "zod": "^3.24.2",
  "better-sqlite3": "^11.8.1",
  "kysely": "^0.27.5",
  "fastify": "^5.2.1",
  "@fastify/cors": "^10.0.2",
  "@fastify/websocket": "^11.0.2",
  "@fastify/static": "^8.1.1",
  "ws": "^8.18.0"
};
pkg.dependencies = { ...cleanedDeps, ...extDeps };
delete pkg.devDependencies;
fs.writeFileSync("'"$BUNDLE_STAGE_DIR"'/package.json", JSON.stringify(pkg, null, 2));
'

# 2. Bundle internal workspace packages under bundle_modules/@agentdeck
mkdir -p "$BUNDLE_STAGE_DIR/bundle_modules/@agentdeck"

for pkg in protocol security database adapter-sdk adapters core shared server; do
  PKG_DIR="$ROOT_DIR/packages/$pkg"
  STAGE_PKG_DIR="$BUNDLE_STAGE_DIR/bundle_modules/@agentdeck/$pkg"
  mkdir -p "$STAGE_PKG_DIR"
  node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("'"$PKG_DIR"'/package.json", "utf8"));
  delete pkg.devDependencies;
  const cleaned = {};
  for (const [k, v] of Object.entries(pkg.dependencies || {})) {
    if (!k.startsWith("@agentdeck/")) {
      cleaned[k] = v;
    }
  }
  pkg.dependencies = cleaned;
  fs.writeFileSync("'"$STAGE_PKG_DIR"'/package.json", JSON.stringify(pkg, null, 2));
  '
  if [ -d "$PKG_DIR/dist" ]; then
    cp -r "$PKG_DIR/dist" "$STAGE_PKG_DIR/dist"
  fi
done

# Create release tarball for CLI
tar -czf "$DIST_DIR/agentdeck-cli.tar.gz" -C "$BUNDLE_STAGE_DIR" package.json dist bundle_modules

# Clean up stage
rm -rf "$BUNDLE_STAGE_DIR"

echo -e "${YELLOW}Packaging Web bundle...${NC}"
tar -czf "$DIST_DIR/agentdeck-web.tar.gz" -C "$ROOT_DIR/apps/web" package.json dist

echo -e "${YELLOW}Generating SHA256 checksums...${NC}"
cd "$DIST_DIR"
sha256sum agentdeck-cli.tar.gz agentdeck-web.tar.gz > checksums.txt

echo -e "\n${GREEN}✔ Release artifacts generated successfully:${NC}"
ls -lh "$DIST_DIR"
cat "$DIST_DIR/checksums.txt"
