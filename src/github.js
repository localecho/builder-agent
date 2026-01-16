import { Octokit } from '@octokit/rest';
import config from './config.js';

/**
 * GitHub API Client
 * Handles all interactions with GitHub repos, PRs, issues, and Actions
 */

let octokit = null;

/**
 * Initialize the Octokit client
 */
export function initGitHub() {
  if (!config.github.token) {
    throw new Error('GITHUB_TOKEN is required');
  }

  octokit = new Octokit({
    auth: config.github.token,
    baseUrl: config.github.baseUrl,
  });

  return octokit;
}

/**
 * Get or create Octokit instance
 */
function getOctokit() {
  if (!octokit) {
    initGitHub();
  }
  return octokit;
}

/**
 * Get repository information
 */
export async function getRepo(owner, repo) {
  const ok = getOctokit();
  const { data } = await ok.repos.get({ owner, repo });
  return data;
}

/**
 * Get open pull requests
 */
export async function getPullRequests(owner, repo, state = 'open') {
  const ok = getOctokit();
  const { data } = await ok.pulls.list({
    owner,
    repo,
    state,
    per_page: 100,
  });
  return data;
}

/**
 * Get a specific pull request
 */
export async function getPullRequest(owner, repo, pullNumber) {
  const ok = getOctokit();
  const { data } = await ok.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });
  return data;
}

/**
 * Create a pull request
 */
export async function createPullRequest(owner, repo, { title, body, head, base }) {
  const ok = getOctokit();
  const { data } = await ok.pulls.create({
    owner,
    repo,
    title,
    body,
    head,
    base,
  });
  return data;
}

/**
 * Get open issues
 */
export async function getIssues(owner, repo, state = 'open') {
  const ok = getOctokit();
  const { data } = await ok.issues.listForRepo({
    owner,
    repo,
    state,
    per_page: 100,
  });
  // Filter out PRs (they show up in issues API too)
  return data.filter(issue => !issue.pull_request);
}

/**
 * Get recent commits
 */
export async function getCommits(owner, repo, options = {}) {
  const ok = getOctokit();
  const { data } = await ok.repos.listCommits({
    owner,
    repo,
    per_page: options.perPage || 50,
    sha: options.sha || undefined,
    since: options.since || undefined,
  });
  return data;
}

/**
 * Get commits since a tag/ref
 */
export async function getCommitsSince(owner, repo, since) {
  const ok = getOctokit();
  try {
    const { data } = await ok.repos.compareCommits({
      owner,
      repo,
      base: since,
      head: 'HEAD',
    });
    return data.commits;
  } catch (error) {
    // If tag doesn't exist, return all recent commits
    return getCommits(owner, repo, { perPage: 100 });
  }
}

/**
 * Get GitHub Actions workflow runs
 */
export async function getWorkflowRuns(owner, repo, options = {}) {
  const ok = getOctokit();
  const { data } = await ok.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    per_page: options.perPage || 20,
    status: options.status || undefined,
    branch: options.branch || undefined,
  });
  return data.workflow_runs;
}

/**
 * Get a specific workflow run
 */
export async function getWorkflowRun(owner, repo, runId) {
  const ok = getOctokit();
  const { data } = await ok.actions.getWorkflowRun({
    owner,
    repo,
    run_id: runId,
  });
  return data;
}

/**
 * Get workflow run jobs
 */
export async function getWorkflowJobs(owner, repo, runId) {
  const ok = getOctokit();
  const { data } = await ok.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: runId,
  });
  return data.jobs;
}

/**
 * Get latest release
 */
export async function getLatestRelease(owner, repo) {
  const ok = getOctokit();
  try {
    const { data } = await ok.repos.getLatestRelease({ owner, repo });
    return data;
  } catch (error) {
    if (error.status === 404) {
      return null; // No releases yet
    }
    throw error;
  }
}

/**
 * Get all tags
 */
export async function getTags(owner, repo) {
  const ok = getOctokit();
  const { data } = await ok.repos.listTags({
    owner,
    repo,
    per_page: 100,
  });
  return data;
}

/**
 * Create a release
 */
export async function createRelease(owner, repo, { tagName, name, body, draft = false, prerelease = false }) {
  const ok = getOctokit();
  const { data } = await ok.repos.createRelease({
    owner,
    repo,
    tag_name: tagName,
    name,
    body,
    draft,
    prerelease,
  });
  return data;
}

/**
 * Create or update a file
 */
export async function createOrUpdateFile(owner, repo, { path, message, content, branch, sha }) {
  const ok = getOctokit();
  const { data } = await ok.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content).toString('base64'),
    branch,
    sha, // Required for updates
  });
  return data;
}

/**
 * Get file contents
 */
export async function getFileContents(owner, repo, path, ref = 'HEAD') {
  const ok = getOctokit();
  try {
    const { data } = await ok.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });
    if (data.type === 'file') {
      return {
        content: Buffer.from(data.content, 'base64').toString('utf-8'),
        sha: data.sha,
      };
    }
    return null;
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Create a branch
 */
export async function createBranch(owner, repo, branchName, fromRef = 'HEAD') {
  const ok = getOctokit();

  // Get the SHA of the ref to branch from
  const { data: refData } = await ok.git.getRef({
    owner,
    repo,
    ref: `heads/${fromRef === 'HEAD' ? 'main' : fromRef}`,
  }).catch(() =>
    ok.git.getRef({ owner, repo, ref: `heads/master` })
  );

  // Create the new branch
  const { data } = await ok.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: refData.object.sha,
  });

  return data;
}

/**
 * Delete a branch
 */
export async function deleteBranch(owner, repo, branchName) {
  const ok = getOctokit();
  await ok.git.deleteRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
  });
}

/**
 * Get repository status summary
 */
export async function getRepoStatus(owner, repo) {
  const [
    repoInfo,
    openPRs,
    openIssues,
    recentRuns,
    latestRelease,
  ] = await Promise.all([
    getRepo(owner, repo),
    getPullRequests(owner, repo, 'open'),
    getIssues(owner, repo, 'open'),
    getWorkflowRuns(owner, repo, { perPage: 10 }),
    getLatestRelease(owner, repo),
  ]);

  // Check for failed builds
  const failedRuns = recentRuns.filter(run => run.conclusion === 'failure');

  return {
    repo: repoInfo,
    openPRs: openPRs.length,
    openIssues: openIssues.length,
    recentBuilds: recentRuns.length,
    failedBuilds: failedRuns.length,
    latestRelease: latestRelease?.tag_name || 'none',
    defaultBranch: repoInfo.default_branch,
    lastPush: repoInfo.pushed_at,
  };
}

export default {
  initGitHub,
  getRepo,
  getPullRequests,
  getPullRequest,
  createPullRequest,
  getIssues,
  getCommits,
  getCommitsSince,
  getWorkflowRuns,
  getWorkflowRun,
  getWorkflowJobs,
  getLatestRelease,
  getTags,
  createRelease,
  createOrUpdateFile,
  getFileContents,
  createBranch,
  deleteBranch,
  getRepoStatus,
};
