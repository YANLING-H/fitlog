#!/usr/bin/env sh
# Rebuild vendor/anthropic-sdk.mjs: the official Anthropic TypeScript SDK bundled as one browser ES module.
# Usage: scripts/build-sdk.sh [version]
set -e
VERSION="${1:-0.133.0}"
TMP="$(mktemp -d)"
cd "$TMP"
npm init -y >/dev/null
npm i "@anthropic-ai/sdk@$VERSION" esbuild@0.24.2 >/dev/null
echo 'export { default } from "@anthropic-ai/sdk";' > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --platform=browser --minify --outfile=anthropic-sdk.mjs
cd - >/dev/null
cp "$TMP/anthropic-sdk.mjs" vendor/anthropic-sdk.mjs
echo "vendor/anthropic-sdk.mjs <- @anthropic-ai/sdk@$VERSION"
