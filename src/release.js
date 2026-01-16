import semver from 'semver';
import {
  getLatestRelease,
  createRelease,
  getFileContents,
  createOrUpdateFile,
  getRepo,
} from './github.js';
import { generateChangelog, determineVersionBump, generateReleaseNotes } from './changelog.js';
import config from './config.js';

/**
 * Release Automation
 * Handles version bumping, tagging, and GitHub releases
 */

/**
 * Get current version from package.json
 */
export async function getCurrentVersion(owner, repo) {
  const pkgFile = await getFileContents(owner, repo, 'package.json');
  if (!pkgFile) {
    // Try to get from latest release
    const release = await getLatestRelease(owner, repo);
    if (release) {
      const version = release.tag_name.replace(/^v/, '');
      if (semver.valid(version)) {
        return version;
      }
    }
    return '0.0.0';
  }

  const pkg = JSON.parse(pkgFile.content);
  return pkg.version || '0.0.0';
}

/**
 * Bump version based on type
 */
export function bumpVersion(currentVersion, bumpType) {
  const version = semver.coerce(currentVersion)?.version || '0.0.0';
  return semver.inc(version, bumpType);
}

/**
 * Create a new release
 */
export async function createNewRelease(owner, repo, options = {}) {
  console.log(`[Release] Creating release for ${owner}/${repo}...`);

  const currentVersion = await getCurrentVersion(owner, repo);
  console.log(`[Release] Current version: ${currentVersion}`);

  // Determine version bump
  let bumpType = options.bumpType;
  if (!bumpType && config.release.versionStrategy === 'conventional') {
    const changelog = await generateChangelog(owner, repo);
    const { getCommitsSince } = await import('./github.js');
    const commits = await getCommitsSince(owner, repo, `v${currentVersion}`).catch(() => []);
    bumpType = determineVersionBump(commits);
    console.log(`[Release] Determined bump type from commits: ${bumpType}`);
  }

  bumpType = bumpType || 'patch';
  const newVersion = options.version || bumpVersion(currentVersion, bumpType);
  console.log(`[Release] New version: ${newVersion}`);

  // Generate release notes
  const releaseNotes = await generateReleaseNotes(owner, repo, newVersion);

  if (options.dryRun) {
    console.log('[Release] Dry run - would create:');
    console.log(`  Tag: v${newVersion}`);
    console.log(`  Notes:\n${releaseNotes}`);
    return { version: newVersion, dryRun: true };
  }

  // Update package.json if exists
  if (options.updatePackageJson !== false) {
    const pkgFile = await getFileContents(owner, repo, 'package.json');
    if (pkgFile) {
      const pkg = JSON.parse(pkgFile.content);
      pkg.version = newVersion;

      const repoInfo = await getRepo(owner, repo);
      await createOrUpdateFile(owner, repo, {
        path: 'package.json',
        message: `chore: release v${newVersion}`,
        content: JSON.stringify(pkg, null, 2),
        branch: repoInfo.default_branch,
        sha: pkgFile.sha,
      });
      console.log('[Release] Updated package.json');
    }
  }

  // Create GitHub release
  if (config.release.createGitHubRelease) {
    const release = await createRelease(owner, repo, {
      tagName: `v${newVersion}`,
      name: `v${newVersion}`,
      body: releaseNotes,
      draft: config.release.draft,
      prerelease: options.prerelease || false,
    });

    console.log(`[Release] Created release: ${release.html_url}`);

    return {
      version: newVersion,
      tagName: `v${newVersion}`,
      url: release.html_url,
      releaseId: release.id,
      notes: releaseNotes,
    };
  }

  return {
    version: newVersion,
    tagName: `v${newVersion}`,
    notes: releaseNotes,
  };
}

/**
 * Create a prerelease (alpha, beta, rc)
 */
export async function createPrerelease(owner, repo, prereleaseType = 'beta') {
  const currentVersion = await getCurrentVersion(owner, repo);
  const version = semver.coerce(currentVersion)?.version || '0.0.0';

  // Increment prerelease
  let newVersion;
  if (semver.prerelease(currentVersion)) {
    // Already a prerelease, increment it
    newVersion = semver.inc(currentVersion, 'prerelease', prereleaseType);
  } else {
    // Create new prerelease
    newVersion = `${semver.inc(version, 'patch')}-${prereleaseType}.0`;
  }

  return createNewRelease(owner, repo, {
    version: newVersion,
    prerelease: true,
  });
}

/**
 * Check if a release is needed
 */
export async function isReleaseNeeded(owner, repo) {
  const latestRelease = await getLatestRelease(owner, repo);
  if (!latestRelease) {
    return { needed: true, reason: 'No previous releases' };
  }

  const sinceTag = latestRelease.tag_name;
  const { getCommitsSince } = await import('./github.js');
  const commits = await getCommitsSince(owner, repo, sinceTag).catch(() => []);

  if (commits.length === 0) {
    return { needed: false, reason: 'No new commits since last release' };
  }

  // Check if there are meaningful commits (not just chores)
  const meaningfulCommits = commits.filter(c => {
    const msg = c.commit.message.toLowerCase();
    return msg.startsWith('feat') || msg.startsWith('fix') || msg.includes('breaking');
  });

  if (meaningfulCommits.length === 0) {
    return {
      needed: false,
      reason: `Only ${commits.length} maintenance commits since last release`,
      commits: commits.length,
    };
  }

  return {
    needed: true,
    reason: `${meaningfulCommits.length} feature/fix commits since ${sinceTag}`,
    commits: commits.length,
    lastRelease: sinceTag,
  };
}

/**
 * Generate release summary
 */
export async function generateReleaseSummary(owner, repo) {
  const currentVersion = await getCurrentVersion(owner, repo);
  const latestRelease = await getLatestRelease(owner, repo);
  const releaseCheck = await isReleaseNeeded(owner, repo);

  return {
    repo: `${owner}/${repo}`,
    currentVersion,
    lastRelease: latestRelease?.tag_name || 'none',
    lastReleaseDate: latestRelease?.published_at,
    releaseNeeded: releaseCheck.needed,
    releaseReason: releaseCheck.reason,
    commitsSinceRelease: releaseCheck.commits || 0,
  };
}

export default {
  getCurrentVersion,
  bumpVersion,
  createNewRelease,
  createPrerelease,
  isReleaseNeeded,
  generateReleaseSummary,
};
