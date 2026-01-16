import { getWorkflowRuns, getWorkflowJobs, getWorkflowRun } from './github.js';
import config from './config.js';

/**
 * Build Status Monitor
 * Tracks GitHub Actions workflow runs and reports failures
 */

/**
 * Get build status for a repo
 */
export async function getBuildStatus(owner, repo) {
  console.log(`[Build] Checking ${owner}/${repo}...`);

  const runs = await getWorkflowRuns(owner, repo, { perPage: 20 });

  const summary = {
    total: runs.length,
    success: 0,
    failure: 0,
    pending: 0,
    cancelled: 0,
    runs: [],
  };

  for (const run of runs) {
    const status = {
      id: run.id,
      name: run.name,
      branch: run.head_branch,
      status: run.status,
      conclusion: run.conclusion,
      startedAt: run.run_started_at,
      updatedAt: run.updated_at,
      url: run.html_url,
      commit: run.head_sha?.substring(0, 7),
      commitMessage: run.head_commit?.message?.split('\n')[0],
    };

    summary.runs.push(status);

    if (run.status === 'in_progress' || run.status === 'queued') {
      summary.pending++;
    } else if (run.conclusion === 'success') {
      summary.success++;
    } else if (run.conclusion === 'failure') {
      summary.failure++;
    } else if (run.conclusion === 'cancelled') {
      summary.cancelled++;
    }
  }

  return summary;
}

/**
 * Get details of failed builds
 */
export async function getFailedBuildDetails(owner, repo) {
  const runs = await getWorkflowRuns(owner, repo, { status: 'failure', perPage: 10 });
  const failures = [];

  for (const run of runs) {
    const jobs = await getWorkflowJobs(owner, repo, run.id);
    const failedJobs = jobs.filter(job => job.conclusion === 'failure');

    failures.push({
      runId: run.id,
      name: run.name,
      branch: run.head_branch,
      commit: run.head_sha?.substring(0, 7),
      commitMessage: run.head_commit?.message?.split('\n')[0],
      url: run.html_url,
      failedAt: run.updated_at,
      failedJobs: failedJobs.map(job => ({
        name: job.name,
        conclusion: job.conclusion,
        steps: job.steps
          ?.filter(s => s.conclusion === 'failure')
          .map(s => ({ name: s.name, conclusion: s.conclusion })),
      })),
    });
  }

  return failures;
}

/**
 * Check if any builds are currently failing
 */
export async function hasFailingBuilds(owner, repo) {
  const status = await getBuildStatus(owner, repo);
  return status.failure > 0;
}

/**
 * Get the most recent build for a branch
 */
export async function getLatestBuild(owner, repo, branch) {
  const runs = await getWorkflowRuns(owner, repo, { branch, perPage: 1 });
  if (runs.length === 0) return null;

  const run = runs[0];
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    url: run.html_url,
    startedAt: run.run_started_at,
    completedAt: run.updated_at,
  };
}

/**
 * Wait for a build to complete
 */
export async function waitForBuild(owner, repo, runId, timeoutMs = 600000) {
  const startTime = Date.now();
  const pollInterval = 10000; // 10 seconds

  console.log(`[Build] Waiting for run ${runId} to complete...`);

  while (Date.now() - startTime < timeoutMs) {
    const run = await getWorkflowRun(owner, repo, runId);

    if (run.status === 'completed') {
      console.log(`[Build] Run completed with conclusion: ${run.conclusion}`);
      return {
        id: run.id,
        conclusion: run.conclusion,
        success: run.conclusion === 'success',
        url: run.html_url,
      };
    }

    console.log(`[Build] Status: ${run.status}... waiting`);
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Build timed out after ${timeoutMs / 1000}s`);
}

/**
 * Generate build status report
 */
export function generateBuildReport(status) {
  const lines = [
    '# Build Status Report',
    '',
    `**Total Runs:** ${status.total}`,
    `**Success:** ${status.success}`,
    `**Failures:** ${status.failure}`,
    `**Pending:** ${status.pending}`,
    '',
  ];

  if (status.failure > 0) {
    lines.push('## Failed Builds');
    lines.push('');
    const failures = status.runs.filter(r => r.conclusion === 'failure');
    for (const run of failures.slice(0, 5)) {
      lines.push(`### ${run.name}`);
      lines.push(`- **Branch:** ${run.branch}`);
      lines.push(`- **Commit:** ${run.commit} - ${run.commitMessage}`);
      lines.push(`- **URL:** ${run.url}`);
      lines.push('');
    }
  }

  if (status.pending > 0) {
    lines.push('## In Progress');
    lines.push('');
    const pending = status.runs.filter(r => r.status === 'in_progress' || r.status === 'queued');
    for (const run of pending) {
      lines.push(`- ${run.name} (${run.branch})`);
    }
    lines.push('');
  }

  lines.push('## Recent Builds');
  lines.push('');
  lines.push('| Workflow | Branch | Status | Commit |');
  lines.push('|----------|--------|--------|--------|');
  for (const run of status.runs.slice(0, 10)) {
    const statusEmoji = run.conclusion === 'success' ? '✅' :
                        run.conclusion === 'failure' ? '❌' :
                        run.status === 'in_progress' ? '🔄' : '⏸️';
    lines.push(`| ${run.name} | ${run.branch} | ${statusEmoji} | ${run.commit} |`);
  }

  return lines.join('\n');
}

export default {
  getBuildStatus,
  getFailedBuildDetails,
  hasFailingBuilds,
  getLatestBuild,
  waitForBuild,
  generateBuildReport,
};
