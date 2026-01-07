#!/bin/bash
# danger-transcode bootstrap script
# Run this directly with: curl -fsSL https://raw.githubusercontent.com/yourorg/danger-transcode/main/scripts/bootstrap.sh | bash
#
# This script:
# 1. Installs minimal dependencies (curl, git)
# 2. Clones the repository
# 3. Runs the full setup script

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       danger-transcode Bootstrap                           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo

# Check if we can use sudo
CAN_SUDO=false
if command -v sudo &> /dev/null; then
    if sudo -n true 2>/dev/null; then
        CAN_SUDO=true
    else
        echo -e "${YELLOW}This script needs sudo access to install packages.${NC}"
        sudo -v || { echo "Cannot get sudo access"; exit 1; }
        CAN_SUDO=true
    fi
elif [ "$EUID" -eq 0 ]; then
    CAN_SUDO=true
fi

run_sudo() {
    if [ "$EUID" -eq 0 ]; then
        "$@"
    else
        sudo "$@"
    fi
}

# Install git if not present
if ! command -v git &> /dev/null; then
    echo -e "${BLUE}→${NC} Installing git..."
    run_sudo apt-get update -qq
    run_sudo apt-get install -y -qq git
fi

# Clone repository
INSTALL_DIR="${DANGER_TRANSCODE_DIR:-$HOME/danger-transcode}"
REPO_URL="${DANGER_TRANSCODE_REPO:-https://github.com/yourorg/danger-transcode.git}"

echo -e "${BLUE}→${NC} Cloning danger-transcode to $INSTALL_DIR..."

if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Directory exists, updating...${NC}"
    cd "$INSTALL_DIR"
    git pull --quiet || true
else
    git clone --quiet "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
        echo -e "${RED}Failed to clone repository.${NC}"
        echo -e "You can manually clone and run setup:"
        echo -e "  git clone $REPO_URL $INSTALL_DIR"
        echo -e "  cd $INSTALL_DIR && bash scripts/setup.sh"
        exit 1
    }
fi

cd "$INSTALL_DIR"

# Run the full setup script
echo
echo -e "${GREEN}Repository cloned. Running setup...${NC}"
echo
exec bash scripts/setup.sh

