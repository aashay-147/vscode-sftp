#!/bin/bash
set -euo pipefail  # Exit on error, undefined vars, and pipeline failures
IFS=$'\n\t'       # Stricter word splitting

# 1. Extract Docker DNS info BEFORE any flushing
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

# Flush existing rules and delete existing ipsets
iptables -F
iptables -X
iptables -t nat -F || true
iptables -t nat -X || true
iptables -t mangle -F || true
iptables -t mangle -X || true
ipset destroy allowed-domains 2>/dev/null || true
ipset destroy allowed-wildcards 2>/dev/null || true

# 2. Selectively restore ONLY internal Docker DNS resolution
if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
else
    echo "No Docker DNS rules to restore"
fi

# Create ipsets
# -exist keeps re-runs from crashing if a set survived a failed destroy; the immediate
# flush then guarantees no stale members carry over (fail-closed, no silent whitelist reuse).
ipset create allowed-domains hash:net -exist
ipset flush allowed-domains
ipset create allowed-wildcards hash:ip timeout 3600 -exist  # IPs expire after 1 hour, refreshed on use
ipset flush allowed-wildcards

# Allow localhost
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Stop any existing dnsmasq instances
pkill dnsmasq 2>/dev/null || true
sleep 1

# Configure dnsmasq for wildcard domain resolution
mkdir -p /etc/dnsmasq.d

# Whitelisted wildcard domains, grouped by category for readability.
# Duplicates here are harmless — the list is de-duplicated before the config is written,
# so a repeated entry can never crash dnsmasq / the firewall init.
WILDCARD_DOMAINS=(
  # Node / npm registry + package tarballs
  npmjs.org   npmjs.com   nodejs.org
  # GitHub (source, gh CLI, release binaries — git-delta, ssh2/cpu-features prebuilds)
  github.com   githubusercontent.com   githubapp.com
  # VS Code marketplace CDN (extension manifests + VSIX downloads happen inside
  # the container; without these the window never finishes attaching after a
  # rebuild). Also used by `vsce` when packaging/publishing this extension.
  vsassets.io   vscode-cdn.net   vscode-unpkg.net
  # Microsoft / Azure (marketplace gallery + login for `vsce publish`)
  microsoft.com   microsoftonline.com   live.com   msauth.net   msftauth.net
  windows.net   azure.com   azure.net   visualstudio.com
  # Claude Code install + telemetry / auth
  anthropic.com   claude.ai   sentry.io   statsig.com
  # Search / reference
  stackoverflow.com   sstatic.net   stackexchange.com
)

# De-duplicate while preserving first-seen order ("check, then add").
declare -A _seen_domains
DEDUP_DOMAINS=()
for domain in "${WILDCARD_DOMAINS[@]}"; do
    if [[ -z "${_seen_domains[$domain]:-}" ]]; then
        _seen_domains[$domain]=1
        DEDUP_DOMAINS+=("$domain")
    else
        echo "Skipping duplicate wildcard domain: $domain"
    fi
done

# Write the dnsmasq config: static header + generated ipset lines + static footer.
{
    cat << 'EOF'
# Don't read /etc/resolv.conf or /etc/hosts
no-resolv
no-hosts

# Use upstream DNS servers
server=8.8.8.8
server=8.8.4.4

# Wildcard domains -> allowed-wildcards ipset (de-duplicated)
EOF
    for domain in "${DEDUP_DOMAINS[@]}"; do
        printf 'ipset=/%s/allowed-wildcards\n' "$domain"
    done
    cat << 'EOF'

# Listen on localhost only
listen-address=127.0.0.1
bind-interfaces

# Cache settings
cache-size=1000

# Logging (optional, comment out for production)
# log-queries
# log-facility=/var/log/dnsmasq.log
EOF
} > /etc/dnsmasq.d/firewall-whitelist.conf

# Backup original resolv.conf if it exists
if [ -f /etc/resolv.conf ] && [ ! -f /etc/resolv.conf.backup ]; then
    cp /etc/resolv.conf /etc/resolv.conf.backup
fi

# Start dnsmasq
echo "Starting dnsmasq for dynamic wildcard resolution..."
dnsmasq --conf-file=/etc/dnsmasq.d/firewall-whitelist.conf

# Update /etc/resolv.conf to use dnsmasq
echo "nameserver 127.0.0.1" > /etc/resolv.conf

# Give dnsmasq a moment to start
sleep 1

# Fetch and add GitHub IP ranges (static)
echo "Fetching GitHub IP ranges..."
gh_ranges=$(curl -s https://api.github.com/meta)
if [ -z "$gh_ranges" ]; then
    echo "WARNING: Failed to fetch GitHub IP ranges"
else
    if echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null 2>&1; then
        echo "Processing GitHub IPs..."
        while read -r cidr; do
            if [[ "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
                echo "Adding GitHub range $cidr"
                ipset add allowed-domains "$cidr" -exist
            fi
        done < <(echo "$gh_ranges" | jq -r '(.web + .api + .git)[]' | aggregate -q)
    else
        echo "WARNING: GitHub API response missing required fields"
    fi
fi

# Static SFTP host (SRGJVImport). Literal IP — added directly to the ipset so
# egress to it is allowed on any port (the SFTP server listens on tcp/99).
echo "Adding SFTP host 91.72.158.162"
ipset add allowed-domains 91.72.158.162 -exist
echo "Adding SFTP host 199.195.118.238"
ipset add allowed-domains 199.195.118.238 -exist

# Get host IP from default route
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
    echo "ERROR: Failed to detect host IP"
    exit 1
fi

HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
echo "Host network detected as: $HOST_NETWORK"

# Set up iptables rules - Allow host network first
iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

# Allow DNS queries to localhost (dnsmasq)
iptables -A OUTPUT -p udp -d 127.0.0.1 --dport 53 -j ACCEPT
iptables -A INPUT -p udp -s 127.0.0.1 --sport 53 -j ACCEPT

# Allow DNS queries to upstream servers (from dnsmasq)
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT

# Allow SSH
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT

# Set default policies to DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Allow established connections for already approved traffic
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow traffic to whitelisted IPs (both static and dynamic from DNS)
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT
iptables -A OUTPUT -m set --match-set allowed-wildcards dst -j ACCEPT

# Reject all other outbound traffic for immediate feedback
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

echo ""
echo "=========================================="
echo "Firewall configuration complete!"
echo "=========================================="
echo ""
echo "Wildcard domain support enabled via dnsmasq. Categories:"
echo "  - Node / npm (*.npmjs.org, *.npmjs.com, *.nodejs.org)"
echo "  - GitHub (*.github.com, *.githubusercontent.com, *.githubapp.com)"
echo "  - VS Code marketplace CDN (*.vsassets.io, *.vscode-cdn.net, *.vscode-unpkg.net)"
echo "  - Microsoft / Azure (*.microsoft.com, *.visualstudio.com, *.windows.net, ...)"
echo "  - Claude Code (*.anthropic.com, claude.ai, *.sentry.io, *.statsig.com)"
echo "  - Stack Overflow / Exchange"
echo ""
echo "Domains are resolved dynamically as they're accessed."
echo "IPs are cached in ipset for 1 hour and refreshed on use."
echo ""

# Verification tests
echo "Running verification tests..."
echo ""

# Test 1: Should fail (not whitelisted)
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "❌ ERROR: Firewall verification failed - was able to reach https://example.com"
    exit 1
else
    echo "✓ Firewall test passed - unable to reach https://example.com (as expected)"
fi

# Test 2: Should succeed (GitHub)
if curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
    echo "✓ Firewall test passed - able to reach https://api.github.com"
else
    echo "❌ WARNING: Unable to reach https://api.github.com"
fi

# Test 3: Should succeed (Microsoft wildcard)
if curl --connect-timeout 5 -I https://www.microsoft.com >/dev/null 2>&1; then
    echo "✓ Firewall test passed - able to reach https://www.microsoft.com (*.microsoft.com)"
else
    echo "❌ WARNING: Unable to reach https://www.microsoft.com"
fi

echo ""
echo "Firewall is active and protecting your container!"
