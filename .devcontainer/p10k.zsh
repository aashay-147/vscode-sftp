# Powerlevel10k overrides — optimized for prompt latency, especially on
# filesystems with slow metadata ops (WSL2 9p, networked mounts).
# Fully portable: these settings just keep the prompt snappy on macOS/Linux too.

# Skip the one-time configuration wizard on first shell start.
typeset -g POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD=true

# Force VCS segment to render asynchronously. 0 = never wait synchronously
# for git data; prompt returns immediately, branch/dirty state fills in after.
typeset -g POWERLEVEL9K_VCS_MAX_SYNC_LATENCY_SECONDS=0

# Keep only the cheap hook. The rest walk the working tree or talk to refs:
#   git-untracked     — walks the whole tree (biggest win on slow filesystems)
#   git-aheadbehind   — remote bookkeeping
#   git-stash         — scans refs/stash
#   git-remotebranch  — extra ref lookups
typeset -g POWERLEVEL9K_VCS_GIT_HOOKS=(vcs-detect-changes)

# Don't surface untracked/submodule state in the status segment either.
typeset -g POWERLEVEL9K_VCS_UNTRACKED_ICON=
typeset -g POWERLEVEL9K_VCS_SHOW_SUBMODULES=false

# Use gitstatusd (p10k's fast daemon). Bounded so it can't hang the prompt.
typeset -g POWERLEVEL9K_VCS_BACKENDS=(git)
typeset -g GITSTATUS_NUM_THREADS=4
