#!/bin/bash
# danger-transcode setup script
# Bootstrap script for a minimal Debian 12 system
# Installs all dependencies and configures the transcoding system

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Detect if we're running from the project directory or standalone
if [ -f "$(dirname "$0")/../deno.json" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
else
    # Running standalone - will clone repo later
    PROJECT_DIR=""
fi

# Default paths
DEFAULT_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/danger-transcode"
DEFAULT_DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/danger-transcode"
DEFAULT_TEMP_DIR="/tmp/danger-transcode"
DENO_INSTALL="${DENO_INSTALL:-$HOME/.deno}"

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
    aarch64|arm64) ARCH="aarch64" ;;
    x86_64|amd64) ARCH="x86_64" ;;
    *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       danger-transcode Setup Script                        ║${NC}"
echo -e "${BLUE}║       For Debian 12 / Rockchip RK3588 Systems              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo
echo -e "Architecture: ${YELLOW}$ARCH${NC}"
echo

# Function to check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Function to print status
print_status() {
    if [ "$2" = "ok" ]; then
        echo -e "${GREEN}✓${NC} $1"
    elif [ "$2" = "warn" ]; then
        echo -e "${YELLOW}⚠${NC} $1"
    elif [ "$2" = "fail" ]; then
        echo -e "${RED}✗${NC} $1"
    else
        echo -e "${BLUE}→${NC} $1"
    fi
}

# Function to check if running as root
check_root() {
    if [ "$EUID" -eq 0 ]; then
        return 0
    else
        return 1
    fi
}

# Function to run with sudo if needed
run_sudo() {
    if check_root; then
        "$@"
    else
        sudo "$@"
    fi
}

#═══════════════════════════════════════════════════════════════════════════════
# STEP 1: Install system packages
#═══════════════════════════════════════════════════════════════════════════════
echo -e "${BLUE}[1/7]${NC} Installing system packages..."
echo

# Check if we need to install packages
NEED_APT_UPDATE=false
PACKAGES_TO_INSTALL=""

for pkg in curl unzip git; do
    if ! command_exists "$pkg"; then
        PACKAGES_TO_INSTALL="$PACKAGES_TO_INSTALL $pkg"
        NEED_APT_UPDATE=true
    else
        print_status "$pkg already installed" "ok"
    fi
done

if [ -n "$PACKAGES_TO_INSTALL" ]; then
    print_status "Installing:$PACKAGES_TO_INSTALL"
    run_sudo apt-get update -qq
    run_sudo apt-get install -y -qq $PACKAGES_TO_INSTALL
    print_status "System packages installed" "ok"
fi

echo

#═══════════════════════════════════════════════════════════════════════════════
# STEP 2: Install Deno
#═══════════════════════════════════════════════════════════════════════════════
echo -e "${BLUE}[2/7]${NC} Installing Deno runtime..."
echo

if command_exists deno; then
    DENO_VERSION=$(deno --version | head -1 | cut -d' ' -f2)
    print_status "Deno $DENO_VERSION already installed" "ok"
else
    print_status "Downloading and installing Deno..."
    curl -fsSL https://deno.land/install.sh | sh -s

    # Add to PATH for current session
    export DENO_INSTALL="$HOME/.deno"
    export PATH="$DENO_INSTALL/bin:$PATH"

    # Add to shell profile if not already there
    SHELL_PROFILE=""
    if [ -f "$HOME/.bashrc" ]; then
        SHELL_PROFILE="$HOME/.bashrc"
    elif [ -f "$HOME/.zshrc" ]; then
        SHELL_PROFILE="$HOME/.zshrc"
    elif [ -f "$HOME/.profile" ]; then
        SHELL_PROFILE="$HOME/.profile"
    fi

    if [ -n "$SHELL_PROFILE" ]; then
        if ! grep -q "DENO_INSTALL" "$SHELL_PROFILE"; then
            echo "" >> "$SHELL_PROFILE"
            echo "# Deno" >> "$SHELL_PROFILE"
            echo "export DENO_INSTALL=\"$HOME/.deno\"" >> "$SHELL_PROFILE"
            echo "export PATH=\"\$DENO_INSTALL/bin:\$PATH\"" >> "$SHELL_PROFILE"
            print_status "Added Deno to $SHELL_PROFILE" "ok"
        fi
    fi

    print_status "Deno installed" "ok"
fi

echo

#═══════════════════════════════════════════════════════════════════════════════
# STEP 3: Install FFmpeg
#═══════════════════════════════════════════════════════════════════════════════
echo -e "${BLUE}[3/7]${NC} Installing FFmpeg..."
echo

HW_ACCEL=false

# Check for existing FFmpeg with Rockchip support
if command_exists ffmpeg; then
    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q "hevc_rkmpp"; then
        print_status "FFmpeg with Rockchip support already installed" "ok"
        HW_ACCEL=true
    else
        print_status "FFmpeg installed but without Rockchip support" "warn"
    fi
fi

# If no hardware-accelerated FFmpeg, offer options
if [ "$HW_ACCEL" = false ]; then
    echo -e "${YELLOW}FFmpeg options:${NC}"
    echo "  1) Install from Debian repos (software encoding only)"
    echo "  2) Install jellyfin-ffmpeg (includes Rockchip support)"
    echo "  3) Skip FFmpeg installation (manual setup later)"
    echo
    read -r -p "Select option [1-3]: " FFMPEG_OPTION

    case "$FFMPEG_OPTION" in
        1)
            print_status "Installing FFmpeg from Debian repos..."
            run_sudo apt-get install -y -qq ffmpeg
            print_status "FFmpeg installed (software encoding)" "ok"
            ;;
        2)
            print_status "Installing jellyfin-ffmpeg with Rockchip support..."

            # Add Jellyfin repo
            run_sudo apt-get install -y -qq apt-transport-https gnupg

            # Import key
            curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key | \
                run_sudo gpg --dearmor -o /usr/share/keyrings/jellyfin-archive-keyring.gpg

            # Add repo
            echo "deb [signed-by=/usr/share/keyrings/jellyfin-archive-keyring.gpg arch=$( dpkg --print-architecture )] https://repo.jellyfin.org/debian bookworm main" | \
                run_sudo tee /etc/apt/sources.list.d/jellyfin.list > /dev/null

            run_sudo apt-get update -qq
            run_sudo apt-get install -y -qq jellyfin-ffmpeg6

            # Create symlinks if needed
            if [ ! -f /usr/bin/ffmpeg ] && [ -f /usr/lib/jellyfin-ffmpeg/ffmpeg ]; then
                run_sudo ln -sf /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg
                run_sudo ln -sf /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe
            fi

            HW_ACCEL=true
            print_status "jellyfin-ffmpeg installed with Rockchip support" "ok"
            ;;
        3)
            print_status "Skipping FFmpeg installation" "warn"
            echo -e "${YELLOW}You'll need to install FFmpeg manually before running transcodes.${NC}"
            echo -e "See: https://github.com/nyanmisaka/ffmpeg-rockchip/wiki"
            ;;
        *)
            print_status "Invalid option, installing from Debian repos..."
            run_sudo apt-get install -y -qq ffmpeg
            ;;
    esac
fi

#═══════════════════════════════════════════════════════════════════════════════
# STEP 4: Clone or update project
#═══════════════════════════════════════════════════════════════════════════════
echo -e "${BLUE}[4/7]${NC} Setting up project..."
echo

REPO_URL="https://github.com/yourorg/danger-transcode.git"
DEFAULT_PROJECT_DIR="$HOME/danger-transcode"

if [ -z "$PROJECT_DIR" ]; then
    # Running standalone - need to clone
    echo -e "${YELLOW}Where should the project be installed?${NC}"
    read -r -p "[$DEFAULT_PROJECT_DIR]: " PROJECT_DIR
    PROJECT_DIR="${PROJECT_DIR:-$DEFAULT_PROJECT_DIR}"

    if [ -d "$PROJECT_DIR" ]; then
        print_status "Project directory exists, updating..."
        cd "$PROJECT_DIR"
        git pull --quiet || true
    else
        print_status "Cloning repository..."
        git clone --quiet "$REPO_URL" "$PROJECT_DIR" 2>/dev/null || {
            # If clone fails (repo doesn't exist yet), create directory structure
            print_status "Creating project directory (repo not available)..." "warn"
            mkdir -p "$PROJECT_DIR"
        }
    fi
else
    print_status "Using existing project directory: $PROJECT_DIR" "ok"
fi

cd "$PROJECT_DIR"
echo

#═══════════════════════════════════════════════════════════════════════════════
# STEP 5: Create directories and configuration
#═══════════════════════════════════════════════════════════════════════════════
echo -e "${BLUE}[5/7]${NC} Creating configuration..."
echo

# Create directories
mkdir -p "$DEFAULT_CONFIG_DIR"
mkdir -p "$DEFAULT_DATA_DIR"
mkdir -p "$DEFAULT_TEMP_DIR"

print_status "Config directory: $DEFAULT_CONFIG_DIR" "ok"
print_status "Data directory: $DEFAULT_DATA_DIR" "ok"
print_status "Temp directory: $DEFAULT_TEMP_DIR" "ok"

CONFIG_FILE="$DEFAULT_CONFIG_DIR/config.json"
CREATE_CONFIG=false

if [ -f "$CONFIG_FILE" ]; then
    echo
    echo -e "${YELLOW}Configuration file already exists: $CONFIG_FILE${NC}"
    read -r -p "Overwrite? (y/N): " response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        CREATE_CONFIG=true
    else
        print_status "Keeping existing configuration" "ok"
    fi
else
    CREATE_CONFIG=true
fi

if [ "$CREATE_CONFIG" = true ]; then
    echo
    echo -e "${YELLOW}Enter media directories (comma-separated):${NC}"
    echo -e "Example: /mnt/media,/mnt/overflow"
    read -r -p "> " MEDIA_DIRS
    MEDIA_DIRS="${MEDIA_DIRS:-/mnt/media}"

    # Convert comma-separated to JSON array
    MEDIA_DIRS_JSON=$(echo "$MEDIA_DIRS" | sed 's/,/","/g' | sed 's/^/["/' | sed 's/$/"]/')

    # Determine FFmpeg paths
    if [ -f /usr/lib/jellyfin-ffmpeg/ffmpeg ]; then
        FFMPEG_PATH="/usr/lib/jellyfin-ffmpeg/ffmpeg"
        FFPROBE_PATH="/usr/lib/jellyfin-ffmpeg/ffprobe"
    else
        FFMPEG_PATH="ffmpeg"
        FFPROBE_PATH="ffprobe"
    fi

    # Hardware acceleration setting
    if [ "$HW_ACCEL" = true ]; then
        USE_HW_ACCEL="true"
    else
        USE_HW_ACCEL="false"
    fi

    cat > "$CONFIG_FILE" << CONFIGEOF
{
  "mediaDirs": $MEDIA_DIRS_JSON,
  "tempDir": "$DEFAULT_TEMP_DIR",
  "databasePath": "$DEFAULT_DATA_DIR/database.json",
  "errorLogPath": "$DEFAULT_DATA_DIR/errors.json",
  "lockFilePath": "$DEFAULT_TEMP_DIR/danger-transcode.lock",
  "maxConcurrency": 1,
  "tvMaxHeight": 720,
  "movieMaxHeight": 1080,
  "bitrates": {
    "low": "2M",
    "medium": "5M",
    "high": "15M"
  },
  "ffmpegPath": "$FFMPEG_PATH",
  "ffprobePath": "$FFPROBE_PATH",
  "useHardwareAccel": $USE_HW_ACCEL,
  "dryRun": false
}
CONFIGEOF

    print_status "Configuration created: $CONFIG_FILE" "ok"
fi

echo

#═══════════════════════════════════════════════════════════════════════════════
# STEP 6: Cache Deno dependencies
#═══════════════════════════════════════════════════════════════════════════════
echo -e "${BLUE}[6/7]${NC} Caching Deno dependencies..."
echo

if [ -f "$PROJECT_DIR/src/main.ts" ]; then
    cd "$PROJECT_DIR"
    "$DENO_INSTALL/bin/deno" cache src/main.ts 2>/dev/null || deno cache src/main.ts
    print_status "Dependencies cached" "ok"
else
    print_status "Project source not found, skipping cache" "warn"
fi

echo

#═══════════════════════════════════════════════════════════════════════════════
# STEP 7: Create helper scripts and systemd service
#═══════════════════════════════════════════════════════════════════════════════
echo -e "${BLUE}[7/7]${NC} Creating helper scripts..."
echo

# Determine deno path
DENO_BIN="$DENO_INSTALL/bin/deno"
if [ ! -f "$DENO_BIN" ]; then
    DENO_BIN=$(command -v deno)
fi

# Create wrapper script
WRAPPER_SCRIPT="$DEFAULT_CONFIG_DIR/transcode"
cat > "$WRAPPER_SCRIPT" << WRAPPEREOF
#!/bin/bash
# danger-transcode wrapper script
# Generated by setup.sh

export DENO_INSTALL="$DENO_INSTALL"
export PATH="\$DENO_INSTALL/bin:\$PATH"

cd "$PROJECT_DIR"
exec deno task start --config "$CONFIG_FILE" "\$@"
WRAPPEREOF
chmod +x "$WRAPPER_SCRIPT"
print_status "Wrapper script: $WRAPPER_SCRIPT" "ok"

# Create symlink in /usr/local/bin if we have permissions
if [ -w /usr/local/bin ] || check_root; then
    run_sudo ln -sf "$WRAPPER_SCRIPT" /usr/local/bin/danger-transcode
    print_status "Symlink created: /usr/local/bin/danger-transcode" "ok"
fi

# Create systemd service if on Linux with systemd
if [ -d "/etc/systemd/system" ]; then
    echo
    read -r -p "Create systemd service for scheduled transcoding? (y/N): " CREATE_SYSTEMD

    if [[ "$CREATE_SYSTEMD" =~ ^[Yy]$ ]]; then
        # Determine user
        if check_root; then
            SERVICE_USER=$(logname 2>/dev/null || echo "$SUDO_USER" || echo "root")
        else
            SERVICE_USER="$USER"
        fi

        SYSTEMD_SERVICE="/etc/systemd/system/danger-transcode.service"
        run_sudo tee "$SYSTEMD_SERVICE" > /dev/null << SERVICEEOF
[Unit]
Description=danger-transcode Media Transcoding Service
After=network.target local-fs.target

[Service]
Type=oneshot
User=$SERVICE_USER
Environment="DENO_INSTALL=$DENO_INSTALL"
Environment="PATH=$DENO_INSTALL/bin:/usr/local/bin:/usr/bin:/bin"
WorkingDirectory=$PROJECT_DIR
ExecStart=$DENO_BIN task start --config $CONFIG_FILE
StandardOutput=journal
StandardError=journal
Nice=10
IOSchedulingClass=idle

[Install]
WantedBy=multi-user.target
SERVICEEOF
        print_status "Systemd service: $SYSTEMD_SERVICE" "ok"

        # Create timer
        SYSTEMD_TIMER="/etc/systemd/system/danger-transcode.timer"
        run_sudo tee "$SYSTEMD_TIMER" > /dev/null << TIMEREOF
[Unit]
Description=Run danger-transcode daily at 2 AM

[Timer]
OnCalendar=*-*-* 02:00:00
RandomizedDelaySec=1800
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF
        print_status "Systemd timer: $SYSTEMD_TIMER" "ok"

        run_sudo systemctl daemon-reload

        echo
        echo -e "${YELLOW}Enable automatic daily transcoding with:${NC}"
        echo -e "  sudo systemctl enable --now danger-transcode.timer"
    fi
fi

echo
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                    Setup Complete!                             ${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo
echo -e "Project directory:  ${YELLOW}$PROJECT_DIR${NC}"
echo -e "Configuration file: ${YELLOW}$CONFIG_FILE${NC}"
echo -e "Database location:  ${YELLOW}$DEFAULT_DATA_DIR/database.json${NC}"
echo -e "Hardware accel:     ${YELLOW}$HW_ACCEL${NC}"
echo
echo -e "${BLUE}Quick start commands:${NC}"
echo
echo -e "  ${GREEN}# Edit configuration${NC}"
echo -e "  nano $CONFIG_FILE"
echo
echo -e "  ${GREEN}# Test run (no changes made)${NC}"
echo -e "  danger-transcode --dry-run --verbose"
echo
echo -e "  ${GREEN}# Start transcoding${NC}"
echo -e "  danger-transcode"
echo
echo -e "  ${GREEN}# View help${NC}"
echo -e "  danger-transcode --help"
echo
if [ -f /etc/systemd/system/danger-transcode.timer ]; then
    echo -e "${BLUE}Systemd commands:${NC}"
    echo -e "  sudo systemctl enable --now danger-transcode.timer  # Enable daily runs"
    echo -e "  sudo systemctl start danger-transcode               # Run now"
    echo -e "  sudo journalctl -u danger-transcode -f              # View logs"
    echo
fi
echo -e "${YELLOW}NOTE: You may need to restart your shell or run:${NC}"
echo -e "  source ~/.bashrc"
echo

