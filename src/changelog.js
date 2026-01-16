import { getCommitsSince, getLatestRelease, getTags } from './github.js';

/**
 * Changelog Generator
 * Generates CHANGELOG.md from conventional commits
 */

// Conventional commit types
const COMMIT_TYPES = {
  feat: { title: 'Features', emoji: '✨' },
  fix: { title: 'Bug Fixes', emoji: '🐛' },
  docs: { title: 'Documentation', emoji: '📚' },
  style: { title: 'Styles', emoji: '💎' },
  refactor: { title: 'Code Refactoring', emoji: '♻️' },
  perf: { title: 'Performance Improvements', emoji: '🚀' },
  test: { title: 'Tests', emoji: '🧪' },
  build: { title: 'Build System', emoji: '📦' },
  ci: { title: 'CI/CD', emoji: '🔧' },
  chore: { title: 'Chores', emoji: '🔨' },
  revert: { title: 'Reverts', emoji: '⏪' },
};

/**
 * Parse a conventional commit message
 */
export function parseCommit(message) {
  // Pattern: type(scope): description
  const pattern = /^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/;
  const match = message.match(pattern);

  if (!match) {
    return {
      type: 'other',
      scope: null,
      description: message,
      breaking: false,
    };
  }

  const [, type, scope, description] = match;
  const breaking = message.includes('BREAKING CHANGE') || message.includes('!:');

  return {
    type: type.toLowerCase(),
    scope: scope || null,
    description,
    breaking,
  };
}

/**
 * Group commits by type
 */
export function groupCommitsByType(commits) {
  const groups = {};
  const breaking = [];

  for (const commit of commits) {
    const parsed = parseCommit(commit.commit.message.split('\n')[0]);

    if (parsed.breaking) {
      breaking.push({
        ...parsed,
        sha: commit.sha.substring(0, 7),
        author: commit.commit.author?.name || 'Unknown',
      });
    }

    const type = parsed.type;
    if (!groups[type]) {
      groups[type] = [];
    }

    groups[type].push({
      ...parsed,
      sha: commit.sha.substring(0, 7),
      author: commit.commit.author?.name || 'Unknown',
      url: commit.html_url,
    });
  }

  return { groups, breaking };
}

/**
 * Generate changelog entry for a version
 */
export function generateChangelogEntry(version, commits) {
  const { groups, breaking } = groupCommitsByType(commits);
  const lines = [];

  // Breaking changes first
  if (breaking.length > 0) {
    lines.push('### BREAKING CHANGES');
    lines.push('');
    for (const commit of breaking) {
      lines.push(`- ${commit.description} (${commit.sha})`);
    }
    lines.push('');
  }

  // Group by type
  const typeOrder = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore'];

  for (const type of typeOrder) {
    if (groups[type] && groups[type].length > 0) {
      const typeInfo = COMMIT_TYPES[type] || { title: type, emoji: '📝' };
      lines.push(`### ${typeInfo.emoji} ${typeInfo.title}`);
      lines.push('');

      for (const commit of groups[type]) {
        const scope = commit.scope ? `**${commit.scope}:** ` : '';
        lines.push(`- ${scope}${commit.description} (${commit.sha})`);
      }
      lines.push('');
    }
  }

  // Other commits
  if (groups.other && groups.other.length > 0) {
    lines.push('### Other Changes');
    lines.push('');
    for (const commit of groups.other) {
      lines.push(`- ${commit.description} (${commit.sha})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate full changelog for a repo
 */
export async function generateChangelog(owner, repo, fromTag = null) {
  console.log(`[Changelog] Generating changelog for ${owner}/${repo}...`);

  // Get the starting point
  let sinceRef = fromTag;
  if (!sinceRef) {
    const latestRelease = await getLatestRelease(owner, repo);
    sinceRef = latestRelease?.tag_name;
  }

  if (!sinceRef) {
    // No releases yet, get recent commits
    const tags = await getTags(owner, repo);
    sinceRef = tags[0]?.name;
  }

  // Get commits since last release/tag
  let commits;
  if (sinceRef) {
    console.log(`[Changelog] Getting commits since ${sinceRef}...`);
    commits = await getCommitsSince(owner, repo, sinceRef);
  } else {
    console.log('[Changelog] No previous release, using recent commits...');
    const { getCommits } = await import('./github.js');
    commits = await getCommits(owner, repo, { perPage: 50 });
  }

  console.log(`[Changelog] Found ${commits.length} commits`);

  if (commits.length === 0) {
    return {
      commits: 0,
      content: 'No changes since last release.',
    };
  }

  const content = generateChangelogEntry('Unreleased', commits);

  return {
    commits: commits.length,
    fromTag: sinceRef,
    content,
  };
}

/**
 * Determine version bump from commits
 */
export function determineVersionBump(commits) {
  let bump = 'patch';

  for (const commit of commits) {
    const parsed = parseCommit(commit.commit.message.split('\n')[0]);

    if (parsed.breaking) {
      return 'major';
    }

    if (parsed.type === 'feat') {
      bump = 'minor';
    }
  }

  return bump;
}

/**
 * Generate release notes
 */
export async function generateReleaseNotes(owner, repo, version) {
  const changelog = await generateChangelog(owner, repo);

  const lines = [
    `# Release ${version}`,
    '',
    changelog.content,
    '',
    '---',
    '',
    `**Full Changelog:** https://github.com/${owner}/${repo}/compare/${changelog.fromTag}...v${version}`,
  ];

  return lines.join('\n');
}

export default {
  parseCommit,
  groupCommitsByType,
  generateChangelogEntry,
  generateChangelog,
  determineVersionBump,
  generateReleaseNotes,
};
