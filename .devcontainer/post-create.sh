#!/usr/bin/env bash
# post-create.sh — runs once after devcontainer creation
# Called from devcontainer.json postCreateCommand.
set -euo pipefail

# ── Install Claude Code if missing ─────────────────────────────────
if ! command -v claude >/dev/null 2>&1; then
  curl -fsSL https://claude.ai/install.sh | bash \
    || npm install -g @anthropic-ai/claude-code \
    || echo "WARN: claude install failed — launch manually if needed"
fi

# ── SSH key setup ──────────────────────────────────────────────────
# Only override core.sshCommand if a known key is present; otherwise leave
# git's default so HTTPS remotes keep working.
if [ -f ~/.ssh/Keys/devops_key_win ]; then
  git config --global core.sshCommand "ssh -o StrictHostKeyChecking=no -i ~/.ssh/Keys/devops_key_win"
elif [ -f ~/.ssh/Keys/devops_ssh_key ]; then
  git config --global core.sshCommand "ssh -o StrictHostKeyChecking=no -i ~/.ssh/Keys/devops_ssh_key"
fi

# ── Git safe directory + performance ───────────────────────────────
git config --global --add safe.directory /workspace
git -C /workspace config core.fsmonitor true || true
git -C /workspace config core.untrackedcache true || true

# ── Install workspace deps ─────────────────────────────────────────
# Runs at create time — BEFORE postStart's firewall locks egress, so the npm
# registry is still reachable here. This is the vscode-sftp extension; a single
# `npm install` provides the full TypeScript/webpack/jest toolchain.
cd /workspace
npm install

echo "post-create complete. Build: 'npm run dev' (watch) or 'npm run compile'. Test: 'npm test'."
