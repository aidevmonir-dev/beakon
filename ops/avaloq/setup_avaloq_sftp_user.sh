#!/usr/bin/env bash
# Provision one chrooted SFTP user for a single bank feed.
#
# Usage (as root on the Swiss VPS):
#   ./setup_avaloq_sftp_user.sh <bank-code> </path/to/bank_pubkey.pub>
#
# Example:
#   ./setup_avaloq_sftp_user.sh gva ~/bank_pubkey.pub
#   → creates user avaloq-gva, chroot /home/avaloq-gva,
#     drop dir /home/avaloq-gva/incoming, installs the bank's public key.
#
# Re-run is safe — `useradd` is gated on existence and key install
# overwrites only the named user's authorized_keys file.
#
# After this script:
#   1. Append ops/avaloq/sshd_config.snippet to /etc/ssh/sshd_config
#      with the User-name and three bank IPs substituted in.
#   2. Apply ops/avaloq/firewall_rules.sh (or hand-port to nftables).
#   3. `systemctl reload sshd`
#   4. Have the bank attempt a test connection from one of their IPs.
#   5. Verify the test zip arrives at /home/avaloq-<bank-code>/incoming/

set -euo pipefail

if [[ $# -lt 2 ]]; then
    echo "Usage: $0 <bank-code> </path/to/bank_pubkey.pub>" >&2
    exit 64
fi

BANK_CODE="$1"
PUBKEY_PATH="$2"
USERNAME="avaloq-${BANK_CODE}"
HOME_DIR="/home/${USERNAME}"
DROP_DIR="${HOME_DIR}/incoming"
KEYS_FILE="/etc/ssh/authorized_keys.d/${USERNAME}"

if [[ "$(id -u)" -ne 0 ]]; then
    echo "Must run as root." >&2
    exit 1
fi
if [[ ! -f "$PUBKEY_PATH" ]]; then
    echo "Public key file not found: $PUBKEY_PATH" >&2
    exit 1
fi

# Create user — no shell, no password.
if ! id "$USERNAME" >/dev/null 2>&1; then
    useradd --create-home --shell /usr/sbin/nologin "$USERNAME"
    passwd -l "$USERNAME"
fi

# Chroot rule: the directory sshd chroots into must be owned by root and
# not group/world writable. The user can only write inside subdirs they own.
chown root:root "$HOME_DIR"
chmod 0755 "$HOME_DIR"

mkdir -p "$DROP_DIR"
chown "$USERNAME":"$USERNAME" "$DROP_DIR"
chmod 0750 "$DROP_DIR"

# Authorized keys for this user — root-owned, immutable to the user.
mkdir -p /etc/ssh/authorized_keys.d
install -o root -g root -m 0600 "$PUBKEY_PATH" "$KEYS_FILE"

echo "Provisioned user '${USERNAME}'."
echo "  Chroot:        ${HOME_DIR}"
echo "  Drop dir:      ${DROP_DIR}"
echo "  Pubkey:        ${KEYS_FILE}"
echo
echo "Next: append the sshd_config.snippet block (substituting the user"
echo "name and bank IPs), run 'sshd -t', then 'systemctl reload sshd'."
