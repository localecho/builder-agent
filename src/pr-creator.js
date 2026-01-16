import {
  createBranch,
  createOrUpdateFile,
  createPullRequest,
  getFileContents,
  getRepo,
} from './github.js';
import { generateUpdatedPackageJson, generateUpdateSummary } from './deps.js';

/**
 * Automated PR Creator
 * Creates branches, updates files, and opens pull requests
 */

/**
 * Create a dependency update PR
 */
export async function createDependencyUpdatePR(owner, repo, updates, packageJson) {
  if (updates.length === 0) {
    console.log('[PR] No updates to create PR for');
    return null;
  }

  const branchName = `deps/update-${Date.now()}`;
  const timestamp = new Date().toISOString().split('T')[0];

  console.log(`[PR] Creating branch ${branchName}...`);

  try {
    // Get the default branch
    const repoInfo = await getRepo(owner, repo);
    const defaultBranch = repoInfo.default_branch;

    // Create branch
    await createBranch(owner, repo, branchName, defaultBranch);

    // Get current package.json SHA for update
    const currentFile = await getFileContents(owner, repo, 'package.json');
    if (!currentFile) {
      throw new Error('Could not read package.json');
    }

    // Generate updated package.json
    const updatedContent = generateUpdatedPackageJson(packageJson, updates);

    // Update package.json in new branch
    console.log('[PR] Updating package.json...');
    await createOrUpdateFile(owner, repo, {
      path: 'package.json',
      message: `chore(deps): update ${updates.length} dependencies`,
      content: updatedContent,
      branch: branchName,
      sha: currentFile.sha,
    });

    // Generate PR body
    const prBody = generatePRBody(updates);

    // Create PR
    console.log('[PR] Opening pull request...');
    const pr = await createPullRequest(owner, repo, {
      title: `chore(deps): update ${updates.length} dependencies [${timestamp}]`,
      body: prBody,
      head: branchName,
      base: defaultBranch,
    });

    console.log(`[PR] Created PR #${pr.number}: ${pr.html_url}`);

    return {
      number: pr.number,
      url: pr.html_url,
      branch: branchName,
      updates,
    };
  } catch (error) {
    console.error('[PR] Error creating PR:', error.message);
    throw error;
  }
}

/**
 * Generate PR body with update details
 */
function generatePRBody(updates) {
  const byType = {
    major: updates.filter(u => u.updateType === 'major'),
    minor: updates.filter(u => u.updateType === 'minor'),
    patch: updates.filter(u => u.updateType === 'patch'),
  };

  const lines = [
    '## Dependency Updates',
    '',
    'This PR updates the following dependencies:',
    '',
  ];

  if (byType.major.length > 0) {
    lines.push('### Major Updates');
    lines.push('');
    for (const u of byType.major) {
      lines.push(`- **${u.name}**: \`${u.currentVersion}\` → \`${u.latestVersion}\``);
    }
    lines.push('');
  }

  if (byType.minor.length > 0) {
    lines.push('### Minor Updates');
    lines.push('');
    for (const u of byType.minor) {
      lines.push(`- **${u.name}**: \`${u.currentVersion}\` → \`${u.latestVersion}\``);
    }
    lines.push('');
  }

  if (byType.patch.length > 0) {
    lines.push('### Patch Updates');
    lines.push('');
    for (const u of byType.patch) {
      lines.push(`- ${u.name}: \`${u.currentVersion}\` → \`${u.latestVersion}\``);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*This PR was automatically created by Builder Agent*');

  return lines.join('\n');
}

/**
 * Create a release PR with changelog
 */
export async function createReleasePR(owner, repo, { version, changelog, branch }) {
  const branchName = branch || `release/v${version}`;

  console.log(`[PR] Creating release PR for v${version}...`);

  try {
    const repoInfo = await getRepo(owner, repo);
    const defaultBranch = repoInfo.default_branch;

    // Create release branch
    await createBranch(owner, repo, branchName, defaultBranch);

    // Update package.json version
    const pkgFile = await getFileContents(owner, repo, 'package.json');
    if (pkgFile) {
      const pkg = JSON.parse(pkgFile.content);
      pkg.version = version;

      await createOrUpdateFile(owner, repo, {
        path: 'package.json',
        message: `chore: bump version to ${version}`,
        content: JSON.stringify(pkg, null, 2),
        branch: branchName,
        sha: pkgFile.sha,
      });
    }

    // Update CHANGELOG.md if provided
    if (changelog) {
      const changelogFile = await getFileContents(owner, repo, 'CHANGELOG.md');
      const existingChangelog = changelogFile?.content || '# Changelog\n';
      const newChangelog = insertChangelogEntry(existingChangelog, version, changelog);

      await createOrUpdateFile(owner, repo, {
        path: 'CHANGELOG.md',
        message: `docs: update changelog for v${version}`,
        content: newChangelog,
        branch: branchName,
        sha: changelogFile?.sha,
      });
    }

    // Create PR
    const pr = await createPullRequest(owner, repo, {
      title: `Release v${version}`,
      body: generateReleasePRBody(version, changelog),
      head: branchName,
      base: defaultBranch,
    });

    console.log(`[PR] Created release PR #${pr.number}: ${pr.html_url}`);

    return {
      number: pr.number,
      url: pr.html_url,
      branch: branchName,
      version,
    };
  } catch (error) {
    console.error('[PR] Error creating release PR:', error.message);
    throw error;
  }
}

/**
 * Insert changelog entry at the top
 */
function insertChangelogEntry(existingChangelog, version, newEntry) {
  const date = new Date().toISOString().split('T')[0];
  const entry = `\n## [${version}] - ${date}\n\n${newEntry}\n`;

  // Insert after the title line
  const lines = existingChangelog.split('\n');
  const titleIndex = lines.findIndex(line => line.startsWith('# '));

  if (titleIndex >= 0) {
    lines.splice(titleIndex + 1, 0, entry);
  } else {
    lines.unshift(`# Changelog${entry}`);
  }

  return lines.join('\n');
}

/**
 * Generate release PR body
 */
function generateReleasePRBody(version, changelog) {
  const lines = [
    `## Release v${version}`,
    '',
    '### Changes',
    '',
    changelog || '_No changelog provided_',
    '',
    '---',
    '',
    '### Checklist',
    '',
    '- [ ] Version bumped in package.json',
    '- [ ] CHANGELOG.md updated',
    '- [ ] All tests passing',
    '- [ ] Ready for release',
    '',
    '*This PR was automatically created by Builder Agent*',
  ];

  return lines.join('\n');
}

/**
 * Create a generic PR with file changes
 */
export async function createPRWithChanges(owner, repo, { title, body, branch, files }) {
  console.log(`[PR] Creating PR: ${title}`);

  try {
    const repoInfo = await getRepo(owner, repo);
    const defaultBranch = repoInfo.default_branch;

    // Create branch
    await createBranch(owner, repo, branch, defaultBranch);

    // Apply file changes
    for (const file of files) {
      const existing = await getFileContents(owner, repo, file.path);

      await createOrUpdateFile(owner, repo, {
        path: file.path,
        message: file.message || `Update ${file.path}`,
        content: file.content,
        branch,
        sha: existing?.sha,
      });
    }

    // Create PR
    const pr = await createPullRequest(owner, repo, {
      title,
      body,
      head: branch,
      base: defaultBranch,
    });

    return {
      number: pr.number,
      url: pr.html_url,
      branch,
    };
  } catch (error) {
    console.error('[PR] Error creating PR:', error.message);
    throw error;
  }
}

export default {
  createDependencyUpdatePR,
  createReleasePR,
  createPRWithChanges,
};
