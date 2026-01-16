import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import semver from 'semver';
import config from './config.js';
import { getFileContents } from './github.js';

const execAsync = promisify(exec);

/**
 * Dependency Update Scanner
 * Detects outdated packages and security vulnerabilities
 */

/**
 * Parse package.json from a repo
 */
export async function getPackageJson(owner, repo) {
  const result = await getFileContents(owner, repo, 'package.json');
  if (!result) return null;
  return JSON.parse(result.content);
}

/**
 * Get latest version of an npm package
 */
export async function getLatestVersion(packageName) {
  try {
    const response = await axios.get(`https://registry.npmjs.org/${packageName}/latest`);
    return response.data.version;
  } catch (error) {
    console.error(`Error fetching ${packageName}:`, error.message);
    return null;
  }
}

/**
 * Get all versions of an npm package
 */
export async function getPackageVersions(packageName) {
  try {
    const response = await axios.get(`https://registry.npmjs.org/${packageName}`);
    return Object.keys(response.data.versions || {});
  } catch (error) {
    console.error(`Error fetching versions for ${packageName}:`, error.message);
    return [];
  }
}

/**
 * Determine update type (patch, minor, major)
 */
export function getUpdateType(currentVersion, newVersion) {
  const current = semver.coerce(currentVersion);
  const latest = semver.coerce(newVersion);

  if (!current || !latest) return 'unknown';

  if (semver.major(latest) > semver.major(current)) return 'major';
  if (semver.minor(latest) > semver.minor(current)) return 'minor';
  if (semver.patch(latest) > semver.patch(current)) return 'patch';

  return 'none';
}

/**
 * Check for outdated dependencies
 */
export async function checkOutdatedDeps(packageJson) {
  const updates = [];
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  console.log(`[Deps] Checking ${Object.keys(deps).length} packages...`);

  for (const [name, currentRange] of Object.entries(deps)) {
    // Skip ignored packages
    if (config.deps.ignoredPackages.includes(name)) {
      continue;
    }

    const latestVersion = await getLatestVersion(name);
    if (!latestVersion) continue;

    // Get the actual version from the range
    const currentVersion = semver.coerce(currentRange)?.version;
    if (!currentVersion) continue;

    // Check if update is available
    if (semver.gt(latestVersion, currentVersion)) {
      const updateType = getUpdateType(currentVersion, latestVersion);
      const isDev = name in (packageJson.devDependencies || {});

      updates.push({
        name,
        currentVersion,
        currentRange,
        latestVersion,
        updateType,
        isDev,
        shouldAutoUpdate: config.deps.autoUpdate[updateType] || false,
      });
    }
  }

  return updates;
}

/**
 * Check npm audit for vulnerabilities
 */
export async function checkVulnerabilities(repoPath) {
  try {
    const { stdout } = await execAsync('npm audit --json', {
      cwd: repoPath,
      timeout: 60000,
    });

    const audit = JSON.parse(stdout);
    return parseAuditResults(audit);
  } catch (error) {
    // npm audit exits with code 1 if vulnerabilities found
    if (error.stdout) {
      try {
        const audit = JSON.parse(error.stdout);
        return parseAuditResults(audit);
      } catch {
        return { vulnerabilities: [], error: error.message };
      }
    }
    return { vulnerabilities: [], error: error.message };
  }
}

/**
 * Parse npm audit results
 */
function parseAuditResults(audit) {
  const vulnerabilities = [];

  if (audit.vulnerabilities) {
    for (const [name, vuln] of Object.entries(audit.vulnerabilities)) {
      vulnerabilities.push({
        name,
        severity: vuln.severity,
        via: vuln.via,
        range: vuln.range,
        fixAvailable: vuln.fixAvailable,
        isDirect: vuln.isDirect,
      });
    }
  }

  return {
    vulnerabilities,
    summary: audit.metadata || {},
  };
}

/**
 * Check GitHub security advisories
 */
export async function checkGitHubAdvisories(packageName) {
  try {
    const response = await axios.get(
      `https://api.github.com/advisories`,
      {
        params: {
          ecosystem: 'npm',
          package: packageName,
        },
        headers: {
          Accept: 'application/vnd.github+json',
        },
      }
    );
    return response.data;
  } catch (error) {
    return [];
  }
}

/**
 * Generate update summary
 */
export function generateUpdateSummary(updates) {
  const byType = {
    major: updates.filter(u => u.updateType === 'major'),
    minor: updates.filter(u => u.updateType === 'minor'),
    patch: updates.filter(u => u.updateType === 'patch'),
  };

  const lines = [
    '# Dependency Update Report',
    '',
    `**Total packages checked:** ${updates.length > 0 ? 'Updates available' : 'All up to date'}`,
    '',
  ];

  if (byType.major.length > 0) {
    lines.push('## Major Updates (Breaking Changes)');
    lines.push('');
    for (const u of byType.major) {
      lines.push(`- **${u.name}**: ${u.currentVersion} → ${u.latestVersion}`);
    }
    lines.push('');
  }

  if (byType.minor.length > 0) {
    lines.push('## Minor Updates (New Features)');
    lines.push('');
    for (const u of byType.minor) {
      lines.push(`- **${u.name}**: ${u.currentVersion} → ${u.latestVersion}`);
    }
    lines.push('');
  }

  if (byType.patch.length > 0) {
    lines.push('## Patch Updates (Bug Fixes)');
    lines.push('');
    for (const u of byType.patch) {
      lines.push(`- ${u.name}: ${u.currentVersion} → ${u.latestVersion}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate updated package.json content
 */
export function generateUpdatedPackageJson(packageJson, updates) {
  const updated = JSON.parse(JSON.stringify(packageJson));

  for (const update of updates) {
    const targetDeps = update.isDev ? 'devDependencies' : 'dependencies';
    if (updated[targetDeps] && updated[targetDeps][update.name]) {
      // Preserve the version prefix (^, ~, etc.)
      const prefix = update.currentRange.match(/^[^0-9]*/)?.[0] || '^';
      updated[targetDeps][update.name] = `${prefix}${update.latestVersion}`;
    }
  }

  return JSON.stringify(updated, null, 2);
}

/**
 * Full dependency scan for a repo
 */
export async function scanDependencies(owner, repo) {
  console.log(`[Deps] Scanning ${owner}/${repo}...`);

  const packageJson = await getPackageJson(owner, repo);
  if (!packageJson) {
    return {
      error: 'No package.json found',
      updates: [],
      vulnerabilities: [],
    };
  }

  const updates = await checkOutdatedDeps(packageJson);

  console.log(`[Deps] Found ${updates.length} outdated packages`);

  return {
    packageJson,
    updates,
    autoUpdates: updates.filter(u => u.shouldAutoUpdate),
    manualUpdates: updates.filter(u => !u.shouldAutoUpdate),
  };
}

export default {
  getPackageJson,
  getLatestVersion,
  getUpdateType,
  checkOutdatedDeps,
  checkVulnerabilities,
  generateUpdateSummary,
  generateUpdatedPackageJson,
  scanDependencies,
};
