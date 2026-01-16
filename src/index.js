#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import config, { validateConfig } from './config.js';
import { initGitHub, getRepoStatus } from './github.js';
import { scanDependencies, generateUpdateSummary } from './deps.js';
import { createDependencyUpdatePR } from './pr-creator.js';
import { getBuildStatus, getFailedBuildDetails, generateBuildReport } from './build-monitor.js';
import { generateChangelog } from './changelog.js';
import { createNewRelease, generateReleaseSummary, isReleaseNeeded } from './release.js';

const program = new Command();

program
  .name('builder')
  .description('Builder Agent - Development automation, CI/CD monitoring, and deployment management')
  .version('0.1.0');

/**
 * Status command - Show status of all monitored repos
 */
program
  .command('status')
  .description('Show status of all monitored repositories')
  .option('-r, --repo <repo>', 'Specific repo (owner/repo)')
  .action(async (options) => {
    console.log(chalk.blue.bold('\n🏗️  Builder Agent Status\n'));

    const validation = validateConfig();
    if (!validation.valid) {
      console.error(chalk.red('Configuration errors:'));
      validation.errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }

    initGitHub();

    const repos = options.repo ? [options.repo] : config.targetRepos;

    for (const repoFullName of repos) {
      const [owner, repo] = repoFullName.split('/');
      console.log(chalk.yellow(`\n📦 ${repoFullName}`));
      console.log('─'.repeat(50));

      try {
        const status = await getRepoStatus(owner, repo);
        console.log(`  Default Branch: ${status.defaultBranch}`);
        console.log(`  Open PRs: ${status.openPRs}`);
        console.log(`  Open Issues: ${status.openIssues}`);
        console.log(`  Recent Builds: ${status.recentBuilds} (${status.failedBuilds} failed)`);
        console.log(`  Latest Release: ${status.latestRelease}`);
        console.log(`  Last Push: ${new Date(status.lastPush).toLocaleString()}`);

        if (status.failedBuilds > 0) {
          console.log(chalk.red(`  ⚠️  ${status.failedBuilds} failed builds!`));
        }
      } catch (error) {
        console.error(chalk.red(`  Error: ${error.message}`));
      }
    }

    console.log('');
  });

/**
 * Update-deps command - Scan and update dependencies
 */
program
  .command('update-deps')
  .description('Scan for outdated dependencies and create update PRs')
  .option('-r, --repo <repo>', 'Specific repo (owner/repo)')
  .option('--dry-run', 'Show what would be updated without creating PRs')
  .option('--auto', 'Only update auto-updatable packages (patch/minor)')
  .action(async (options) => {
    console.log(chalk.blue.bold('\n📦 Dependency Update Scanner\n'));

    const validation = validateConfig();
    if (!validation.valid) {
      console.error(chalk.red('Configuration errors:'));
      validation.errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }

    initGitHub();

    const repos = options.repo ? [options.repo] : config.targetRepos;

    for (const repoFullName of repos) {
      const [owner, repo] = repoFullName.split('/');
      console.log(chalk.yellow(`\n🔍 Scanning ${repoFullName}...`));

      try {
        const result = await scanDependencies(owner, repo);

        if (result.error) {
          console.error(chalk.red(`  Error: ${result.error}`));
          continue;
        }

        const updates = options.auto ? result.autoUpdates : result.updates;

        if (updates.length === 0) {
          console.log(chalk.green('  ✓ All dependencies are up to date!'));
          continue;
        }

        console.log(`\n  Found ${updates.length} outdated packages:`);
        console.log(generateUpdateSummary(updates));

        if (options.dryRun) {
          console.log(chalk.gray('  (dry run - no PR created)'));
          continue;
        }

        // Create PR for updates
        console.log('\n  Creating update PR...');
        const pr = await createDependencyUpdatePR(owner, repo, updates, result.packageJson);

        if (pr) {
          console.log(chalk.green(`  ✓ Created PR #${pr.number}: ${pr.url}`));
        }
      } catch (error) {
        console.error(chalk.red(`  Error: ${error.message}`));
      }
    }

    console.log('');
  });

/**
 * Builds command - Show build status
 */
program
  .command('builds')
  .description('Show build status for monitored repos')
  .option('-r, --repo <repo>', 'Specific repo (owner/repo)')
  .option('--failures', 'Show only failed builds with details')
  .action(async (options) => {
    console.log(chalk.blue.bold('\n🔨 Build Status\n'));

    const validation = validateConfig();
    if (!validation.valid) {
      console.error(chalk.red('Configuration errors:'));
      validation.errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }

    initGitHub();

    const repos = options.repo ? [options.repo] : config.targetRepos;

    for (const repoFullName of repos) {
      const [owner, repo] = repoFullName.split('/');
      console.log(chalk.yellow(`\n📦 ${repoFullName}`));

      try {
        if (options.failures) {
          const failures = await getFailedBuildDetails(owner, repo);
          if (failures.length === 0) {
            console.log(chalk.green('  ✓ No failed builds!'));
          } else {
            for (const failure of failures) {
              console.log(chalk.red(`\n  ❌ ${failure.name}`));
              console.log(`     Branch: ${failure.branch}`);
              console.log(`     Commit: ${failure.commit} - ${failure.commitMessage}`);
              console.log(`     Failed jobs: ${failure.failedJobs.map(j => j.name).join(', ')}`);
              console.log(`     URL: ${failure.url}`);
            }
          }
        } else {
          const status = await getBuildStatus(owner, repo);
          console.log(generateBuildReport(status));
        }
      } catch (error) {
        console.error(chalk.red(`  Error: ${error.message}`));
      }
    }

    console.log('');
  });

/**
 * Changelog command - Generate changelog
 */
program
  .command('changelog')
  .description('Generate changelog from commits')
  .option('-r, --repo <repo>', 'Specific repo (owner/repo)')
  .option('--since <tag>', 'Generate changelog since this tag')
  .action(async (options) => {
    console.log(chalk.blue.bold('\n📝 Changelog Generator\n'));

    const validation = validateConfig();
    if (!validation.valid) {
      console.error(chalk.red('Configuration errors:'));
      validation.errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }

    initGitHub();

    const repos = options.repo ? [options.repo] : config.targetRepos;

    for (const repoFullName of repos) {
      const [owner, repo] = repoFullName.split('/');
      console.log(chalk.yellow(`\n📦 ${repoFullName}`));

      try {
        const changelog = await generateChangelog(owner, repo, options.since);
        console.log(`\n  Commits: ${changelog.commits}`);
        console.log(`  Since: ${changelog.fromTag || 'beginning'}`);
        console.log('\n' + changelog.content);
      } catch (error) {
        console.error(chalk.red(`  Error: ${error.message}`));
      }
    }

    console.log('');
  });

/**
 * Release command - Create a release
 */
program
  .command('release')
  .description('Create a new release')
  .option('-r, --repo <repo>', 'Specific repo (owner/repo)')
  .option('--bump <type>', 'Version bump type: major, minor, patch')
  .option('--version <version>', 'Specific version to release')
  .option('--dry-run', 'Show what would be released without creating')
  .option('--prerelease <type>', 'Create prerelease: alpha, beta, rc')
  .action(async (options) => {
    console.log(chalk.blue.bold('\n🚀 Release Manager\n'));

    const validation = validateConfig();
    if (!validation.valid) {
      console.error(chalk.red('Configuration errors:'));
      validation.errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }

    initGitHub();

    const repos = options.repo ? [options.repo] : config.targetRepos;

    for (const repoFullName of repos) {
      const [owner, repo] = repoFullName.split('/');
      console.log(chalk.yellow(`\n📦 ${repoFullName}`));

      try {
        // Check if release is needed
        const summary = await generateReleaseSummary(owner, repo);
        console.log(`  Current version: ${summary.currentVersion}`);
        console.log(`  Last release: ${summary.lastRelease}`);
        console.log(`  Release needed: ${summary.releaseNeeded ? 'Yes' : 'No'}`);
        console.log(`  Reason: ${summary.releaseReason}`);

        if (!summary.releaseNeeded && !options.bump && !options.version) {
          console.log(chalk.gray('  Skipping - no release needed'));
          continue;
        }

        const release = await createNewRelease(owner, repo, {
          bumpType: options.bump,
          version: options.version,
          dryRun: options.dryRun,
          prerelease: !!options.prerelease,
        });

        if (options.dryRun) {
          console.log(chalk.gray(`  Would release: v${release.version}`));
        } else {
          console.log(chalk.green(`\n  ✓ Released v${release.version}`));
          if (release.url) {
            console.log(`    ${release.url}`);
          }
        }
      } catch (error) {
        console.error(chalk.red(`  Error: ${error.message}`));
      }
    }

    console.log('');
  });

// Parse arguments
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
