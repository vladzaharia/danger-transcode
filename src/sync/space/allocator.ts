/**
 * Bin-Packing Allocator
 * Allocates media items to destination drives using First-Fit Decreasing algorithm
 * with constraint that TV shows must stay together on one drive
 */

import type {
  SyncItem,
  DestinationDrive,
  DriveAllocation,
  AllocationPlan,
} from '../types.ts';
import { formatBytes } from '../../shared/format.ts';

/** Get available space on a drive */
async function getDriveSpace(path: string): Promise<{ total: number; free: number }> {
  try {
    // Use Deno.statfs if available (Deno 1.38+)
    if ('statfs' in Deno) {
      const stats = await (Deno as unknown as { statfs: (path: string) => Promise<{ blocks: number; bfree: number; bsize: number }> }).statfs(path);
      return {
        total: stats.blocks * stats.bsize,
        free: stats.bfree * stats.bsize,
      };
    }

    // Fallback: use df command
    const command = new Deno.Command('df', {
      args: ['-B1', path],
      stdout: 'piped',
      stderr: 'piped',
    });

    const { stdout } = await command.output();
    const output = new TextDecoder().decode(stdout);
    const lines = output.trim().split('\n');

    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      if (parts.length >= 4) {
        return {
          total: parseInt(parts[1], 10),
          free: parseInt(parts[3], 10),
        };
      }
    }

    throw new Error('Could not parse df output');
  } catch (error) {
    console.warn(`Could not get drive space for ${path}:`, error);
    // Return a large default if we can't determine
    return { total: 1e15, free: 1e15 };
  }
}

/** Group TV seasons by show */
function groupTVShowSeasons(items: SyncItem[]): Map<string, SyncItem[]> {
  const groups = new Map<string, SyncItem[]>();

  for (const item of items) {
    if (item.type === 'tv_season') {
      // Extract show identifier from path (parent directory)
      const showPath = item.sourcePath.replace(/[/\\]Season\s*\d+.*$/i, '');
      const existing = groups.get(showPath) || [];
      existing.push(item);
      groups.set(showPath, existing);
    }
  }

  return groups;
}

/** Calculate total size of a group of items */
function groupSize(items: SyncItem[]): number {
  return items.reduce((sum, item) => sum + item.estimatedSize, 0);
}

/** Allocation item (can be single movie or grouped TV show) */
interface AllocationUnit {
  items: SyncItem[];
  totalSize: number;
  priority: number;
  isTVShow: boolean;
  showPath?: string;
}

/** Create allocation units from sync items */
function createAllocationUnits(items: SyncItem[]): AllocationUnit[] {
  const units: AllocationUnit[] = [];

  // Group TV seasons by show
  const tvGroups = groupTVShowSeasons(items);

  // Add TV show groups as units
  for (const [showPath, seasons] of tvGroups) {
    units.push({
      items: seasons,
      totalSize: groupSize(seasons),
      priority: Math.max(...seasons.map((s) => s.priority)),
      isTVShow: true,
      showPath,
    });
  }

  // Add movies as individual units
  for (const item of items) {
    if (item.type === 'movie') {
      units.push({
        items: [item],
        totalSize: item.estimatedSize,
        priority: item.priority,
        isTVShow: false,
      });
    }
  }

  return units;
}

/** Initialize drive allocations */
async function initializeDriveAllocations(
  drives: DestinationDrive[]
): Promise<DriveAllocation[]> {
  const allocations: DriveAllocation[] = [];

  for (const drive of drives) {
    const space = await getDriveSpace(drive.path);
    const availableSpace = Math.max(0, space.free - drive.reservedBytes);

    allocations.push({
      drive,
      totalCapacity: space.total,
      usedSpace: space.total - space.free,
      availableSpace,
      allocatedItems: [],
      allocatedSize: 0,
    });
  }

  // Sort by priority (lower = preferred)
  allocations.sort((a, b) => a.drive.priority - b.drive.priority);

  return allocations;
}

/** First-Fit Decreasing bin-packing algorithm */
function firstFitDecreasing(
  units: AllocationUnit[],
  allocations: DriveAllocation[]
): { allocated: AllocationUnit[]; unallocated: AllocationUnit[] } {
  // Sort units by size (descending) for FFD
  const sortedUnits = [...units].sort((a, b) => b.totalSize - a.totalSize);

  const allocated: AllocationUnit[] = [];
  const unallocated: AllocationUnit[] = [];

  for (const unit of sortedUnits) {
    let placed = false;

    // Try to fit in each drive (in priority order)
    for (const allocation of allocations) {
      const remainingSpace = allocation.availableSpace - allocation.allocatedSize;

      if (unit.totalSize <= remainingSpace) {
        // Place the unit on this drive
        allocation.allocatedItems.push(...unit.items);
        allocation.allocatedSize += unit.totalSize;
        allocated.push(unit);
        placed = true;
        break;
      }
    }

    if (!placed) {
      unallocated.push(unit);
    }
  }

  return { allocated, unallocated };
}

/** Best-Fit optimization pass - try to improve allocation */
function optimizeAllocation(allocations: DriveAllocation[]): void {
  // Try to move items from fuller drives to emptier ones if it improves balance
  for (let i = allocations.length - 1; i > 0; i--) {
    const sourceDrive = allocations[i];
    if (sourceDrive.allocatedItems.length === 0) continue;

    for (let j = 0; j < i; j++) {
      const targetDrive = allocations[j];
      const targetRemaining = targetDrive.availableSpace - targetDrive.allocatedSize;

      // Try to move small items to better-priority drives
      for (let k = sourceDrive.allocatedItems.length - 1; k >= 0; k--) {
        const item = sourceDrive.allocatedItems[k];

        // Don't split TV shows
        if (item.type === 'tv_season') {
          // Check if all seasons of this show are on source drive
          const showSeasons = sourceDrive.allocatedItems.filter(
            (i) => i.type === 'tv_season' && i.title === item.title
          );
          const totalShowSize = showSeasons.reduce((sum, s) => sum + s.estimatedSize, 0);

          if (totalShowSize <= targetRemaining) {
            // Move entire show
            for (const season of showSeasons) {
              const idx = sourceDrive.allocatedItems.indexOf(season);
              if (idx !== -1) {
                sourceDrive.allocatedItems.splice(idx, 1);
                sourceDrive.allocatedSize -= season.estimatedSize;
                targetDrive.allocatedItems.push(season);
                targetDrive.allocatedSize += season.estimatedSize;
              }
            }
          }
        } else if (item.estimatedSize <= targetRemaining) {
          // Move single movie
          sourceDrive.allocatedItems.splice(k, 1);
          sourceDrive.allocatedSize -= item.estimatedSize;
          targetDrive.allocatedItems.push(item);
          targetDrive.allocatedSize += item.estimatedSize;
        }
      }
    }
  }
}

/** Create allocation plan for sync items */
export async function createAllocationPlan(
  items: SyncItem[],
  drives: DestinationDrive[]
): Promise<AllocationPlan> {
  const warnings: string[] = [];

  // Initialize drive allocations
  const allocations = await initializeDriveAllocations(drives);

  // Check if any drives have space
  const totalAvailable = allocations.reduce((sum, a) => sum + a.availableSpace, 0);
  if (totalAvailable === 0) {
    warnings.push('No available space on any destination drive');
    return {
      allocations,
      unallocatedItems: items,
      totalItemsAllocated: 0,
      totalSizeAllocated: 0,
      warnings,
    };
  }

  // Create allocation units (grouping TV shows)
  const units = createAllocationUnits(items);

  // Run First-Fit Decreasing
  const { allocated, unallocated } = firstFitDecreasing(units, allocations);

  // Optimize allocation
  optimizeAllocation(allocations);

  // Generate warnings for unallocated items
  if (unallocated.length > 0) {
    const unallocatedSize = unallocated.reduce((sum, u) => sum + u.totalSize, 0);
    warnings.push(
      `${unallocated.length} items (${formatBytes(unallocatedSize)}) could not be allocated due to space constraints`
    );

    // List large unallocated items
    for (const unit of unallocated.slice(0, 5)) {
      if (unit.isTVShow) {
        warnings.push(`  - TV Show: ${unit.items[0].title} (${formatBytes(unit.totalSize)})`);
      } else {
        warnings.push(`  - Movie: ${unit.items[0].title} (${formatBytes(unit.totalSize)})`);
      }
    }
    if (unallocated.length > 5) {
      warnings.push(`  ... and ${unallocated.length - 5} more`);
    }
  }

  // Flatten unallocated items
  const unallocatedItems = unallocated.flatMap((u) => u.items);

  // Calculate totals
  const totalItemsAllocated = allocations.reduce((sum, a) => sum + a.allocatedItems.length, 0);
  const totalSizeAllocated = allocations.reduce((sum, a) => sum + a.allocatedSize, 0);

  return {
    allocations,
    unallocatedItems,
    totalItemsAllocated,
    totalSizeAllocated,
    warnings,
  };
}

/** Print allocation plan summary */
export function printAllocationPlan(plan: AllocationPlan): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    ALLOCATION PLAN');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const allocation of plan.allocations) {
    const usagePercent = (allocation.allocatedSize / allocation.availableSpace) * 100;
    console.log(`📁 ${allocation.drive.label} (${allocation.drive.path})`);
    console.log(`   Available: ${formatBytes(allocation.availableSpace)}`);
    console.log(`   Allocated: ${formatBytes(allocation.allocatedSize)} (${usagePercent.toFixed(1)}%)`);
    console.log(`   Items: ${allocation.allocatedItems.length}`);

    // Group items by type
    const movies = allocation.allocatedItems.filter((i) => i.type === 'movie');
    const tvSeasons = allocation.allocatedItems.filter((i) => i.type === 'tv_season');

    if (movies.length > 0) {
      console.log(`   Movies: ${movies.length}`);
    }
    if (tvSeasons.length > 0) {
      // Group by show
      const shows = new Map<string, number>();
      for (const season of tvSeasons) {
        shows.set(season.title, (shows.get(season.title) || 0) + 1);
      }
      console.log(`   TV Shows: ${shows.size} (${tvSeasons.length} seasons)`);
    }
    console.log('');
  }

  console.log('───────────────────────────────────────────────────────────────');
  console.log(`Total Items Allocated: ${plan.totalItemsAllocated}`);
  console.log(`Total Size Allocated: ${formatBytes(plan.totalSizeAllocated)}`);

  if (plan.unallocatedItems.length > 0) {
    console.log(`\n⚠️  Unallocated Items: ${plan.unallocatedItems.length}`);
  }

  if (plan.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    for (const warning of plan.warnings) {
      console.log(`   ${warning}`);
    }
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

