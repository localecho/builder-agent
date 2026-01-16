import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import config from './config.js';
import { getLatestBuild, waitForBuild } from './build-monitor.js';
import { notify } from './notify.js';

const execAsync = promisify(exec);

/**
 * Deployment Trigger
 * Triggers deployment on successful builds
 */

/**
 * Check if deployment should be triggered
 */
export function shouldDeploy(branch, conclusion) {
  // Only deploy on successful builds
  if (conclusion !== 'success') {
    return { should: false, reason: `Build conclusion: ${conclusion}` };
  }

  // Only deploy from configured branches
  if (!config.deploy.triggerBranches.includes(branch)) {
    return { should: false, reason: `Branch ${branch} not in trigger list` };
  }

  // Check if deployment is configured
  if (!config.deploy.command && !config.deploy.webhookUrl) {
    return { should: false, reason: 'No deployment method configured' };
  }

  return { should: true };
}

/**
 * Trigger deployment via command
 */
export async function deployViaCommand(options = {}) {
  const command = config.deploy.command;
  if (!command) {
    throw new Error('No deploy command configured');
  }

  console.log(`[Deploy] Running: ${command}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 600000, // 10 minutes
      env: {
        ...process.env,
        DEPLOY_BRANCH: options.branch,
        DEPLOY_COMMIT: options.commit,
        DEPLOY_REPO: options.repo,
      },
    });

    console.log('[Deploy] Command output:', stdout);
    if (stderr) {
      console.log('[Deploy] Stderr:', stderr);
    }

    return {
      success: true,
      method: 'command',
      output: stdout,
    };
  } catch (error) {
    console.error('[Deploy] Command failed:', error.message);
    return {
      success: false,
      method: 'command',
      error: error.message,
    };
  }
}

/**
 * Trigger deployment via webhook
 */
export async function deployViaWebhook(options = {}) {
  const webhookUrl = config.deploy.webhookUrl;
  if (!webhookUrl) {
    throw new Error('No deploy webhook configured');
  }

  console.log(`[Deploy] Triggering webhook: ${webhookUrl}`);

  try {
    const payload = {
      event: 'deploy',
      repo: options.repo,
      branch: options.branch,
      commit: options.commit,
      buildId: options.buildId,
      timestamp: new Date().toISOString(),
    };

    const response = await axios.post(webhookUrl, payload, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Builder-Agent/1.0',
      },
    });

    console.log('[Deploy] Webhook response:', response.status);

    return {
      success: response.status >= 200 && response.status < 300,
      method: 'webhook',
      status: response.status,
      data: response.data,
    };
  } catch (error) {
    console.error('[Deploy] Webhook failed:', error.message);
    return {
      success: false,
      method: 'webhook',
      error: error.message,
    };
  }
}

/**
 * Main deployment trigger function
 */
export async function triggerDeployment(owner, repo, options = {}) {
  const repoFullName = `${owner}/${repo}`;
  console.log(`[Deploy] Checking deployment for ${repoFullName}...`);

  // Get latest build if not provided
  let build = options.build;
  if (!build) {
    const branch = options.branch || config.deploy.triggerBranches[0];
    build = await getLatestBuild(owner, repo, branch);

    if (!build) {
      console.log('[Deploy] No recent builds found');
      return { triggered: false, reason: 'No builds found' };
    }
  }

  // Check if we should deploy
  const check = shouldDeploy(options.branch || build.branch, build.conclusion);
  if (!check.should) {
    console.log(`[Deploy] Skipping: ${check.reason}`);
    return { triggered: false, reason: check.reason };
  }

  // Wait for build to complete if still running
  if (build.status !== 'completed') {
    console.log('[Deploy] Waiting for build to complete...');
    const result = await waitForBuild(owner, repo, build.id);
    if (!result.success) {
      console.log('[Deploy] Build failed, skipping deployment');
      return { triggered: false, reason: 'Build failed' };
    }
  }

  const deployOptions = {
    repo: repoFullName,
    branch: options.branch || build.branch,
    commit: build.commit || build.head_sha?.substring(0, 7),
    buildId: build.id,
  };

  // Trigger deployment
  let result;
  if (config.deploy.webhookUrl) {
    result = await deployViaWebhook(deployOptions);
  } else if (config.deploy.command) {
    result = await deployViaCommand(deployOptions);
  } else {
    return { triggered: false, reason: 'No deployment method configured' };
  }

  // Send notification
  if (result.success) {
    await notify({
      text: `🚀 Deployment triggered for ${repoFullName}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🚀 *Deployment Triggered*\n*Repo:* ${repoFullName}\n*Branch:* ${deployOptions.branch}\n*Commit:* ${deployOptions.commit}`,
          },
        },
      ],
    });
  } else {
    await notify({
      text: `❌ Deployment failed for ${repoFullName}: ${result.error}`,
    });
  }

  return {
    triggered: true,
    success: result.success,
    method: result.method,
    error: result.error,
  };
}

/**
 * Deploy all configured repos
 */
export async function deployAll(options = {}) {
  const results = [];

  for (const repoFullName of config.targetRepos) {
    const [owner, repo] = repoFullName.split('/');
    const result = await triggerDeployment(owner, repo, options);
    results.push({ repo: repoFullName, ...result });
  }

  return results;
}

/**
 * Create a deployment status check
 */
export function createDeploymentSummary(results) {
  const triggered = results.filter(r => r.triggered);
  const successful = results.filter(r => r.triggered && r.success);
  const failed = results.filter(r => r.triggered && !r.success);

  const lines = [
    '# Deployment Summary',
    '',
    `**Total Repos:** ${results.length}`,
    `**Triggered:** ${triggered.length}`,
    `**Successful:** ${successful.length}`,
    `**Failed:** ${failed.length}`,
    '',
  ];

  if (successful.length > 0) {
    lines.push('## Successful Deployments');
    lines.push('');
    for (const r of successful) {
      lines.push(`- ✅ ${r.repo} (${r.method})`);
    }
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push('## Failed Deployments');
    lines.push('');
    for (const r of failed) {
      lines.push(`- ❌ ${r.repo}: ${r.error}`);
    }
    lines.push('');
  }

  const skipped = results.filter(r => !r.triggered);
  if (skipped.length > 0) {
    lines.push('## Skipped');
    lines.push('');
    for (const r of skipped) {
      lines.push(`- ⏭️ ${r.repo}: ${r.reason}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export default {
  shouldDeploy,
  deployViaCommand,
  deployViaWebhook,
  triggerDeployment,
  deployAll,
  createDeploymentSummary,
};
