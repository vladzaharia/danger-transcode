# danger-transcode

Hardware-accelerated media transcoding system for Rockchip devices (NanoPi M6, RK3588).

## Features

- **Hardware-accelerated encoding** using Rockchip MPP (hevc_rkmpp)
- **Automatic media classification** (TV shows, Movies, Other)
- **Resolution-based transcoding**:
  - TV shows: Max 720p (no upscaling)
  - Movies: Max 1080p (no upscaling)
  - Other: Original resolution
- **HEVC/H.265 output** for optimal storage efficiency
- **Incremental processing** - tracks transcoded files
- **Concurrent transcoding** support
- **Error tracking** with retry capability
- **Singleton execution** - prevents multiple instances

## Requirements

- [Deno](https://deno.land/) 2.x runtime
- FFmpeg with Rockchip support ([nyanmisaka/ffmpeg-rockchip](https://github.com/nyanmisaka/ffmpeg-rockchip))
- Rockchip SoC with VPU (RK3588/RK3588S recommended)

## Installation

### One-Line Install (Debian 12)

On a fresh Debian 12 system (like NanoPi M6), run:

```bash
curl -fsSL https://raw.githubusercontent.com/yourorg/danger-transcode/main/scripts/bootstrap.sh | bash
```

Or if you've already cloned the repo:

```bash
git clone https://github.com/yourorg/danger-transcode.git
cd danger-transcode
bash scripts/setup.sh
```

### What the Setup Script Does

The setup script handles everything needed on a minimal Debian 12 install:

1. **Installs system packages**: curl, git, unzip
2. **Installs Deno runtime**: Downloads and configures Deno 2.x
3. **Installs FFmpeg**: Offers choice between:
   - Debian's FFmpeg (software encoding)
   - jellyfin-ffmpeg (includes Rockchip hardware acceleration)
4. **Creates directories**: Config, data, and temp directories
5. **Generates configuration**: Interactive prompts for media directories
6. **Caches dependencies**: Pre-downloads all Deno modules
7. **Creates helper scripts**: `danger-transcode` command
8. **Optionally creates systemd service**: For scheduled daily transcoding

### Manual Installation

If you prefer manual setup:

1. Install Deno:

```bash
curl -fsSL https://deno.land/install.sh | sh
```

2. Install FFmpeg with Rockchip support (see [ffmpeg-rockchip wiki](https://github.com/nyanmisaka/ffmpeg-rockchip/wiki))

3. Clone and configure:

```bash
git clone https://github.com/yourorg/danger-transcode.git
cd danger-transcode
mkdir -p ~/.config/danger-transcode
cp config.example.json ~/.config/danger-transcode/config.json
nano ~/.config/danger-transcode/config.json
```

## Usage

### Basic Usage

```bash
# Run with default settings
deno task start

# Dry run to preview what would be transcoded
deno task start --dry-run --verbose

# Scan specific directories
deno task start --media-dirs /mnt/media,/mnt/overflow
```

### CLI Options

```
-h, --help           Show help message
-v, --version        Show version
-c, --config <path>  Path to configuration file
-n, --dry-run        Simulate transcoding without changes
--verbose            Enable verbose output
--quiet              Suppress non-error output
--clear-errors       Clear error records and retry failed files
--list-errors        List files that failed to transcode
--media-dirs <dirs>  Comma-separated list of media directories
--concurrency <n>    Number of concurrent transcodes (default: 1)
```

### Environment Variables

| Variable                     | Description                       | Default                                   |
| ---------------------------- | --------------------------------- | ----------------------------------------- |
| `TRANSCODE_MEDIA_DIRS`       | Comma-separated media directories | `/mnt/media,/mnt/overflow`                |
| `TRANSCODE_TEMP_DIR`         | Temporary directory               | `/tmp/danger-transcode`                   |
| `TRANSCODE_DB_PATH`          | Database file path                | `/var/lib/danger-transcode/database.json` |
| `TRANSCODE_CONCURRENCY`      | Concurrent transcodes             | `1`                                       |
| `TRANSCODE_TV_MAX_HEIGHT`    | Max TV show height                | `720`                                     |
| `TRANSCODE_MOVIE_MAX_HEIGHT` | Max movie height                  | `1080`                                    |
| `FFMPEG_PATH`                | Path to ffmpeg                    | `ffmpeg`                                  |
| `FFPROBE_PATH`               | Path to ffprobe                   | `ffprobe`                                 |
| `TRANSCODE_HW_ACCEL`         | Enable hardware acceleration      | `true`                                    |
| `TRANSCODE_DRY_RUN`          | Enable dry run mode               | `false`                                   |

### Cron Job Setup

Add to crontab (`crontab -e`):

```bash
# Run nightly at 2 AM
0 2 * * * /home/user/.deno/bin/deno task --cwd /path/to/danger-transcode start >> /var/log/transcode.log 2>&1
```

## Configuration File

Create a JSON config file:

```json
{
  "mediaDirs": ["/mnt/media", "/mnt/overflow"],
  "tempDir": "/tmp/danger-transcode",
  "maxConcurrency": 1,
  "tvMaxHeight": 720,
  "movieMaxHeight": 1080,
  "bitrates": {
    "low": "2M",
    "medium": "5M",
    "high": "15M"
  }
}
```

## Media Classification

Files are automatically classified based on:

- **TV Shows**: Path contains "TV", "Shows", "Series", or filename matches `S01E01` pattern
- **Movies**: Path contains "Movie" or "Film"
- **Other**: Everything else (web series, YouTube downloads, etc.)

## License

MIT
