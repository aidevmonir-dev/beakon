#!/usr/bin/env bash
# Lock port 22 to the three Avaloq source IPs and nothing else.
#
# Run as root. Idempotent — re-running clears the Beakon-managed chain
# and rebuilds it from the IP list below.
#
# This is the *authoritative* allowlist. sshd_config.snippet's AllowUsers
# line is a second wall — if you change the IPs, change them in both.

set -euo pipefail

# Source IPs from the spec doc, section 1:
BANK_IPS=(
    "194.38.173.1"   # Physical 1
    "194.38.173.2"   # VIP
    "194.38.173.3"   # Physical 2
)

if [[ "$(id -u)" -ne 0 ]]; then
    echo "Must run as root." >&2
    exit 1
fi

# We use a dedicated chain so the rule set is reset cleanly on re-run
# without touching anything else on the host.
CHAIN="BEAKON_AVALOQ_SFTP"

# Create or flush our chain.
if iptables -L "$CHAIN" >/dev/null 2>&1; then
    iptables -F "$CHAIN"
else
    iptables -N "$CHAIN"
fi

# Make sure INPUT routes port-22 traffic through our chain (idempotent).
if ! iptables -C INPUT -p tcp --dport 22 -j "$CHAIN" 2>/dev/null; then
    iptables -I INPUT -p tcp --dport 22 -j "$CHAIN"
fi

# Allow each bank IP.
for ip in "${BANK_IPS[@]}"; do
    iptables -A "$CHAIN" -s "$ip" -p tcp --dport 22 -m conntrack \
        --ctstate NEW,ESTABLISHED -j ACCEPT
done

# Drop everything else hitting 22 (with rate-limited logging so a
# scanning attempt is visible but doesn't fill /var/log).
iptables -A "$CHAIN" -p tcp --dport 22 -m limit --limit 5/min \
    -j LOG --log-prefix "BEAKON-AVALOQ-DROP " --log-level 4
iptables -A "$CHAIN" -p tcp --dport 22 -j DROP

echo "Allowlisted ${#BANK_IPS[@]} bank IP(s) for port 22 SFTP."
iptables -L "$CHAIN" -n -v
echo
echo "Persist across reboots with:"
echo "  iptables-save > /etc/iptables/rules.v4"
