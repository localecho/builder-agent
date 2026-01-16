# Builder Agent

Autonomous agent for development automation, CI/CD monitoring, and deployment management.

## Purpose
Part of 6-agent team (Scout, **Builder**, Marketer, Analyst, Orchestrator, Archivist).
Builder handles code generation, testing, CI/CD pipelines, and deployments.

## Capabilities
- GitHub repo monitoring (PRs, issues, commits, Actions)
- Dependency update scanning and automated PRs
- Build status tracking and failure alerts
- Changelog generation from conventional commits
- Release automation (version bump, tag, publish)
- Deployment triggers on successful builds

## Stack
- Node.js + ES Modules
- Octokit (GitHub API)
- node-cron (scheduling)
- Conventional Commits parsing

## Directory Structure
```
builder-agent/
├── src/
│   ├── config.js       # Configuration loader
│   ├── github.js       # GitHub API client
│   ├── deps.js         # Dependency scanner
│   ├── pr-creator.js   # Automated PR creation
│   ├── build-monitor.js # CI/CD status tracking
│   ├── changelog.js    # Changelog generator
│   ├── release.js      # Release automation
│   ├── notify.js       # Notifications
│   ├── quality.js      # Code quality checks
│   ├── deploy.js       # Deployment triggers
│   ├── daemon.js       # Continuous monitoring
│   └── index.js        # CLI entry point
├── plans/
│   ├── prd.json        # Product requirements
│   └── progress.txt    # Sprint progress
├── data/               # Runtime data
└── package.json
```

## Commands
```bash
npm run builder status      # Show repo status
npm run builder update-deps # Scan and update dependencies
npm run builder changelog   # Generate changelog
npm run builder release     # Create new release
npm run daemon              # Start continuous monitoring
```

## Environment Variables
```
GITHUB_TOKEN=ghp_xxx        # GitHub personal access token
TARGET_REPOS=owner/repo1,owner/repo2
SLACK_WEBHOOK=https://...   # Optional notifications
```

## Ralph Loop
This project uses the Ralph Wiggum technique for autonomous development.
- PRD: plans/prd.json
- Progress: plans/progress.txt
