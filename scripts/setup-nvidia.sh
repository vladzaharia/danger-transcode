#!/bin/bash
#═══════════════════════════════════════════════════════════════════════════════
# NVIDIA GPU Setup Script for danger-transcode
# Target: Ubuntu 24.04 LTS with NVIDIA GPU
#
# This script installs:
# - NVIDIA drivers (if not present)
# - CUDA toolkit
# - FFmpeg with NVENC support
# - Deno runtime
#═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

#───────────────────────────────────────────────────────────────────────────────
# Check prerequisites
#───────────────────────────────────────────────────────────────────────────────

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

check_ubuntu() {
    if ! grep -q "Ubuntu" /etc/os-release 2>/dev/null; then
        log_warn "This script is designed for Ubuntu. Proceed with caution."
    fi
    
    # Check for Ubuntu 24.04
    if grep -q "24.04" /etc/os-release 2>/dev/null; then
        log_info "Detected Ubuntu 24.04 LTS"
    else
        log_warn "This script is optimized for Ubuntu 24.04. Your version may differ."
    fi
}

check_nvidia_gpu() {
    if ! lspci | grep -i nvidia > /dev/null 2>&1; then
        log_error "No NVIDIA GPU detected. This script requires an NVIDIA GPU."
        exit 1
    fi
    log_info "NVIDIA GPU detected"
}

#───────────────────────────────────────────────────────────────────────────────
# Installation functions
#───────────────────────────────────────────────────────────────────────────────

install_nvidia_drivers() {
    log_info "Installing NVIDIA drivers..."
    
    # Check if drivers are already installed
    if nvidia-smi > /dev/null 2>&1; then
        log_success "NVIDIA drivers already installed"
        nvidia-smi --query-gpu=name,driver_version --format=csv,noheader
        return 0
    fi
    
    # Add NVIDIA PPA for latest drivers
    add-apt-repository -y ppa:graphics-drivers/ppa
    apt-get update
    
    # Install recommended driver
    ubuntu-drivers autoinstall
    
    log_success "NVIDIA drivers installed. A reboot may be required."
}

install_cuda() {
    log_info "Installing CUDA toolkit..."
    
    # Check if CUDA is already installed
    if command -v nvcc > /dev/null 2>&1; then
        log_success "CUDA already installed: $(nvcc --version | grep release)"
        return 0
    fi
    
    # Install CUDA toolkit from Ubuntu repos (simpler than NVIDIA's installer)
    apt-get install -y nvidia-cuda-toolkit
    
    log_success "CUDA toolkit installed"
}

install_ffmpeg_nvenc() {
    log_info "Installing FFmpeg with NVENC support..."
    
    # Check if FFmpeg with NVENC is already available
    if ffmpeg -encoders 2>/dev/null | grep -q hevc_nvenc; then
        log_success "FFmpeg with NVENC already installed"
        return 0
    fi
    
    # Install FFmpeg (Ubuntu 24.04 includes NVENC support)
    apt-get install -y ffmpeg
    
    # Verify NVENC support
    if ffmpeg -encoders 2>/dev/null | grep -q hevc_nvenc; then
        log_success "FFmpeg installed with NVENC support"
    else
        log_warn "FFmpeg installed but NVENC not detected. You may need to install from source."
    fi
}

install_deno() {
    log_info "Installing Deno runtime..."
    
    # Check if Deno is already installed
    if command -v deno > /dev/null 2>&1; then
        log_success "Deno already installed: $(deno --version | head -1)"
        return 0
    fi
    
    # Install Deno
    curl -fsSL https://deno.land/install.sh | sh
    
    # Add to PATH for current session
    export DENO_INSTALL="$HOME/.deno"
    export PATH="$DENO_INSTALL/bin:$PATH"
    
    # Add to bashrc for future sessions
    if ! grep -q "DENO_INSTALL" ~/.bashrc 2>/dev/null; then
        echo 'export DENO_INSTALL="$HOME/.deno"' >> ~/.bashrc
        echo 'export PATH="$DENO_INSTALL/bin:$PATH"' >> ~/.bashrc
    fi
    
    log_success "Deno installed"
}

#───────────────────────────────────────────────────────────────────────────────
# Verification
#───────────────────────────────────────────────────────────────────────────────

verify_installation() {
    log_info "Verifying installation..."
    
    local errors=0
    
    # Check NVIDIA driver
    if nvidia-smi > /dev/null 2>&1; then
        log_success "✓ NVIDIA driver working"
    else
        log_error "✗ NVIDIA driver not working"
        ((errors++))
    fi
    
    # Check FFmpeg NVENC
    if ffmpeg -encoders 2>/dev/null | grep -q hevc_nvenc; then
        log_success "✓ FFmpeg NVENC encoder available"
    else
        log_error "✗ FFmpeg NVENC encoder not available"
        ((errors++))
    fi
    
    # Check Deno
    if command -v deno > /dev/null 2>&1; then
        log_success "✓ Deno runtime available"
    else
        log_error "✗ Deno runtime not available"
        ((errors++))
    fi
    
    if [[ $errors -eq 0 ]]; then
        log_success "All components installed successfully!"
        return 0
    else
        log_error "$errors component(s) failed verification"
        return 1
    fi
}

print_config_example() {
    cat << 'EOF'

#═══════════════════════════════════════════════════════════════════════════════
# Example configuration for NVIDIA GPU
#═══════════════════════════════════════════════════════════════════════════════

Create a config file at ~/.config/danger-transcode/config.json:

{
  "mediaDirs": ["/path/to/your/media"],
  "tempDir": "/tmp/danger-transcode",
  "databasePath": "/var/lib/danger-transcode/database.json",
  "errorLogPath": "/var/lib/danger-transcode/errors.json",
  "hardwareProfile": "nvidia",
  "nvidia": {
    "preset": "p5",
    "tune": "hq",
    "rcMode": "vbr",
    "lookahead": 20,
    "temporalAq": true,
    "bFrames": 3
  },
  "tvMaxHeight": 720,
  "movieMaxHeight": 1080,
  "bitrates": {
    "low": "2M",
    "medium": "5M",
    "high": "15M"
  }
}

Then run: deno task start --config ~/.config/danger-transcode/config.json

EOF
}

#───────────────────────────────────────────────────────────────────────────────
# Main execution
#───────────────────────────────────────────────────────────────────────────────

main() {
    echo "═══════════════════════════════════════════════════════════════════════════════"
    echo " NVIDIA GPU Setup for danger-transcode"
    echo " Target: Ubuntu 24.04 LTS"
    echo "═══════════════════════════════════════════════════════════════════════════════"
    echo

    # Run checks
    check_root
    check_ubuntu
    check_nvidia_gpu

    echo
    log_info "Starting installation..."
    echo

    # Update package lists
    apt-get update

    # Install components
    install_nvidia_drivers
    install_cuda
    install_ffmpeg_nvenc
    install_deno

    echo
    log_info "Running verification..."
    echo

    # Verify everything works
    if verify_installation; then
        print_config_example
        echo
        log_success "Setup complete! You may need to reboot for driver changes to take effect."
    else
        log_error "Setup completed with errors. Please check the output above."
        exit 1
    fi
}

# Run main function
main "$@"

