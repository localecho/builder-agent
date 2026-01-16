import dotenv from 'dotenv';
dotenv.config();

/**
 * Builder Agent Configuration
 */
export const config = {
  // GitHub settings
  github: {
    token: process.env.GITHUB_TOKEN || '',
    baseUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
  },

  // Target repositories to monitor (owner/repo format)
  targetRepos: (process.env.TARGET_REPOS || '')
    .split(',')
    .map(r => r.trim())
    .filter(Boolean),

  // Build settings
  build: {
    // Commands to run for different project types
    commands: {
      node: {
        install: 'npm ci',
        build: 'npm run build',
        test: 'npm test',
        lint: 'npm run lint',
      },
      python: {
        install: 'pip install -r requirements.txt',
        build: 'python setup.py build',
        test: 'pytest',
        lint: 'flake8',
      },
    },
    // Timeout for build commands (ms)
    timeout: parseInt(process.env.BUILD_TIMEOUT || '300000'),
  },

  // Dependency update settings
  deps: {
    // Auto-create PRs for these update types
    autoUpdate: {
      patch: true,   // 1.0.0 -> 1.0.1
      minor: true,   // 1.0.0 -> 1.1.0
      major: false,  // 1.0.0 -> 2.0.0 (manual review)
    },
    // Skip these packages from auto-updates
    ignoredPackages: (process.env.IGNORED_PACKAGES || '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean),
    // Check for security vulnerabilities
    checkVulnerabilities: true,
  },

  // Release settings
  release: {
    // Branch to release from
    releaseBranch: process.env.RELEASE_BRANCH || 'main',
    // Version bump strategy: 'conventional' (from commits) or 'manual'
    versionStrategy: process.env.VERSION_STRATEGY || 'conventional',
    // Generate changelog on release
    generateChangelog: true,
    // Create GitHub release
    createGitHubRelease: true,
    // Draft release (requires manual publish)
    draft: false,
  },

  // Notification settings
  notifications: {
    slack: {
      webhookUrl: process.env.SLACK_WEBHOOK || '',
      channel: process.env.SLACK_CHANNEL || '#builds',
    },
    discord: {
      webhookUrl: process.env.DISCORD_WEBHOOK || '',
    },
    email: {
      enabled: !!process.env.EMAIL_RECIPIENT,
      to: process.env.EMAIL_RECIPIENT || '',
      from: process.env.EMAIL_FROM || 'builder@localhost',
    },
  },

  // Events to notify on
  notifyOn: {
    buildFailure: true,
    buildSuccess: false,  // Too noisy usually
    prOpened: true,
    prMerged: true,
    releaseCreated: true,
    securityAlert: true,
    dependencyUpdate: true,
  },

  // Daemon settings
  daemon: {
    // Check interval in minutes
    checkInterval: parseInt(process.env.CHECK_INTERVAL || '30'),
    // Cron schedule (overrides checkInterval if set)
    schedule: process.env.BUILDER_SCHEDULE || null,
  },

  // Deployment settings
  deploy: {
    // Trigger deployment on merge to these branches
    triggerBranches: (process.env.DEPLOY_BRANCHES || 'main')
      .split(',')
      .map(b => b.trim()),
    // Deployment command or webhook
    command: process.env.DEPLOY_COMMAND || '',
    webhookUrl: process.env.DEPLOY_WEBHOOK || '',
  },
};

/**
 * Validate required configuration
 */
export function validateConfig() {
  const errors = [];

  if (!config.github.token) {
    errors.push('GITHUB_TOKEN is required');
  }

  if (config.targetRepos.length === 0) {
    errors.push('TARGET_REPOS is required (comma-separated owner/repo)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get config for a specific repo
 */
export function getRepoConfig(repoFullName) {
  const [owner, repo] = repoFullName.split('/');
  return {
    owner,
    repo,
    fullName: repoFullName,
    ...config,
  };
}

export default config;
