#!/usr/bin/env node

import cron from 'node-cron';
import chalk from 'chalk';
import config, { validateConfig } from './config.js';
import { initGitHub, getRepoStatus } from './github.js';
import { scanDependencies } from './deps.js';
import { createDependencyUpdatePR } from './pr-creator.js';
import { getBuildStatus, getFailedBuildDetails } from './build-monitor.js';
import { isReleaseNeeded } from './release.js';
import {
  notifyBuildFailure,
  notifyDependencyUpdate,
  notify,
} from './notify.js';

/**
 * Builder Agent Daemon
 * Continuous monitoring of repositories
 */

// Configuration
const CHECK_INTERVAL = config.daemon.checkInterval || 30;
const SCHEDULE = config.daemon.schedule || `*/${CHECK_INTERVAL} * * * *`;

console.log(chalk.blue.bold('\n🤖 Builder Agent Daemon Starting...\n'));

// Validate config
const validation = validateConfig();
if (!validation.valid) {
  console.error(chalk.red('Configuration errors:'));
  validation.errors.forEach(e => console.error(`  - ${e}`));
  process.exit(1);
}

console.log('Configuration:');
console.log(`  Check Interval: ${CHECK_INTERVAL} minutes`);
console.log(`  Schedule: ${SCHEDULE}`);
console.log(`  Target Repos: ${config.targetRepos.length}`);
config.targetRepos.forEach(r => console.log(`    - ${r}`));
console.log('');

// Initialize GitHub client
initGitHub();

// State tracking
let isRunning = false;
let checkCount = 0;
let lastCheck = null;
const repoState = new Map();

/**
 * Check a single repository
 */
async function checkRepo(repoFullName) {
  const [owner, repo] = repoFullName.split('/');
  const prevState = repoState.get(repoFullName) || {};

  console.log(chalk.gray(`  Checking ${repoFullName}...`));

  try {
    // Get current status
    const status = await getRepoStatus(owner, repo);

    // Check for new build failures
    if (status.failedBuilds > 0 && status.failedBuilds !== prevState.failedBuilds) {
      const failures = await getFailedBuildDetails(owner, repo);
      for (const failure of failures.slice(0, 3)) {
        console.log(chalk.red(`    ❌ Build failed: ${failure.name}`));
        await notifyBuildFailure(repoFullName, failure);
      }
    }

    // Check for outdated dependencies (less frequently)
    if (checkCount % 4 === 0) { // Every 4th check (~2 hours with 30min interval)
      const deps = await scanDependencies(owner, repo);
      if (deps.autoUpdates && deps.autoUpdates.length > 0) {
        console.log(chalk.yellow(`    📦 ${deps.autoUpdates.length} auto-updatable packages`));

        // Auto-create PR for minor/patch updates
        if (config.deps.autoUpdate.minor || config.deps.autoUpdate.patch) {
          const autoUpdates = deps.autoUpdates.filter(u =>
            (u.updateType === 'minor' && config.deps.autoUpdate.minor) ||
            (u.updateType === 'patch' && config.deps.autoUpdate.patch)
          );

          if (autoUpdates.length > 0 && !prevState.pendingDepsPR) {
            console.log(chalk.yellow(`    Creating dependency update PR...`));
            try {
              const pr = await createDependencyUpdatePR(owner, repo, autoUpdates, deps.packageJson);
              if (pr) {
                console.log(chalk.green(`    ✓ Created PR #${pr.number}`));
                await notifyDependencyUpdate(repoFullName, pr, autoUpdates);
                prevState.pendingDepsPR = pr.number;
              }
            } catch (error) {
              console.log(chalk.gray(`    PR creation skipped: ${error.message}`));
            }
          }
        }
      }
    }

    // Check if release is needed
    const releaseCheck = await isReleaseNeeded(owner, repo);
    if (releaseCheck.needed && !prevState.releaseNotified) {
      console.log(chalk.cyan(`    🚀 Release may be needed: ${releaseCheck.reason}`));
      prevState.releaseNotified = true;
    }

    // Update state
    repoState.set(repoFullName, {
      ...prevState,
      failedBuilds: status.failedBuilds,
      lastCheck: new Date(),
    });

    return { success: true, status };
  } catch (error) {
    console.log(chalk.red(`    Error: ${error.message}`));
    return { success: false, error: error.message };
  }
}

/**
 * Run a full check cycle
 */
async function runCheck() {
  if (isRunning) {
    console.log(chalk.yellow('Previous check still running, skipping...'));
    return;
  }

  isRunning = true;
  checkCount++;
  const startTime = Date.now();

  console.log(chalk.blue(`\n${'='.repeat(60)}`));
  console.log(chalk.blue(`🔄 Check #${checkCount} - ${new Date().toLocaleString()}`));
  console.log(chalk.blue('='.repeat(60)));

  const results = [];

  for (const repo of config.targetRepos) {
    const result = await checkRepo(repo);
    results.push({ repo, ...result });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successful = results.filter(r => r.success).length;

  console.log(chalk.blue(`\n✓ Check complete in ${elapsed}s (${successful}/${results.length} repos OK)`));

  lastCheck = new Date();
  isRunning = false;
}

/**
 * Show daemon status
 */
function showStatus() {
  const uptime = Math.floor(process.uptime());
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);

  console.log(chalk.gray('\n📊 Daemon Status:'));
  console.log(chalk.gray(`  Uptime: ${hours}h ${mins}m`));
  console.log(chalk.gray(`  Checks completed: ${checkCount}`));
  console.log(chalk.gray(`  Last check: ${lastCheck?.toLocaleString() || 'Never'}`));
  console.log(chalk.gray(`  Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`));
}

// Run initial check
console.log('Running initial check...\n');
runCheck().then(() => {
  console.log(chalk.green('\n✓ Initial check complete'));
  console.log(chalk.gray('Daemon is now running. Press Ctrl+C to stop.\n'));
});

// Schedule recurring checks
const task = cron.schedule(SCHEDULE, runCheck);

// Show status every hour
const statusInterval = setInterval(showStatus, 60 * 60 * 1000);

// Handle graceful shutdown
function shutdown(signal) {
  console.log(chalk.yellow(`\n\n🛑 Received ${signal}, shutting down...`));
  task.stop();
  clearInterval(statusInterval);
  console.log(chalk.green('✓ Daemon stopped'));
  console.log(`  Completed ${checkCount} checks during this session`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Keep process alive
process.stdin.resume();

export { runCheck, checkRepo };
