import axios from 'axios';
import config from './config.js';

/**
 * Notification System
 * Sends alerts for build events via Slack, Discord, and email
 */

/**
 * Send Slack notification
 */
export async function sendSlackNotification(message, options = {}) {
  const webhookUrl = config.notifications.slack.webhookUrl;
  if (!webhookUrl) {
    console.log('[Notify] Slack webhook not configured');
    return false;
  }

  try {
    const payload = {
      text: message.text || message,
      channel: options.channel || config.notifications.slack.channel,
      username: options.username || 'Builder Agent',
      icon_emoji: options.icon || ':robot_face:',
    };

    // Support rich formatting with blocks
    if (message.blocks) {
      payload.blocks = message.blocks;
    }

    await axios.post(webhookUrl, payload);
    console.log('[Notify] Slack notification sent');
    return true;
  } catch (error) {
    console.error('[Notify] Slack error:', error.message);
    return false;
  }
}

/**
 * Send Discord notification
 */
export async function sendDiscordNotification(message, options = {}) {
  const webhookUrl = config.notifications.discord.webhookUrl;
  if (!webhookUrl) {
    console.log('[Notify] Discord webhook not configured');
    return false;
  }

  try {
    const payload = {
      content: message.text || message,
      username: options.username || 'Builder Agent',
    };

    // Support embeds for rich formatting
    if (message.embeds) {
      payload.embeds = message.embeds;
    }

    await axios.post(webhookUrl, payload);
    console.log('[Notify] Discord notification sent');
    return true;
  } catch (error) {
    console.error('[Notify] Discord error:', error.message);
    return false;
  }
}

/**
 * Send email notification (placeholder - would use nodemailer)
 */
export async function sendEmailNotification(subject, body) {
  if (!config.notifications.email.enabled) {
    console.log('[Notify] Email not configured');
    return false;
  }

  // TODO: Implement with nodemailer
  console.log(`[Notify] Would send email to ${config.notifications.email.to}`);
  console.log(`  Subject: ${subject}`);
  return true;
}

/**
 * Notify on build failure
 */
export async function notifyBuildFailure(repo, build) {
  if (!config.notifyOn.buildFailure) return;

  const message = {
    text: `❌ Build failed: ${repo}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '❌ Build Failed' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Repository:*\n${repo}` },
          { type: 'mrkdwn', text: `*Workflow:*\n${build.name}` },
          { type: 'mrkdwn', text: `*Branch:*\n${build.branch}` },
          { type: 'mrkdwn', text: `*Commit:*\n${build.commit}` },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View Build' },
            url: build.url,
          },
        ],
      },
    ],
  };

  await Promise.all([
    sendSlackNotification(message),
    sendDiscordNotification({
      embeds: [{
        title: '❌ Build Failed',
        color: 0xff0000,
        fields: [
          { name: 'Repository', value: repo, inline: true },
          { name: 'Workflow', value: build.name, inline: true },
          { name: 'Branch', value: build.branch, inline: true },
          { name: 'Commit', value: build.commit, inline: true },
        ],
        url: build.url,
      }],
    }),
    sendEmailNotification(`Build Failed: ${repo}`, `Build ${build.name} failed on ${build.branch}`),
  ]);
}

/**
 * Notify on build success
 */
export async function notifyBuildSuccess(repo, build) {
  if (!config.notifyOn.buildSuccess) return;

  const message = {
    text: `✅ Build passed: ${repo}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `✅ *Build Passed*: ${repo} - ${build.name}` },
      },
    ],
  };

  await sendSlackNotification(message);
}

/**
 * Notify on PR opened
 */
export async function notifyPROpened(repo, pr) {
  if (!config.notifyOn.prOpened) return;

  const message = {
    text: `🔀 New PR: ${pr.title}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🔀 New Pull Request' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Repository:*\n${repo}` },
          { type: 'mrkdwn', text: `*Title:*\n${pr.title}` },
          { type: 'mrkdwn', text: `*Author:*\n${pr.author}` },
          { type: 'mrkdwn', text: `*Number:*\n#${pr.number}` },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View PR' },
            url: pr.url,
          },
        ],
      },
    ],
  };

  await sendSlackNotification(message);
}

/**
 * Notify on PR merged
 */
export async function notifyPRMerged(repo, pr) {
  if (!config.notifyOn.prMerged) return;

  const message = {
    text: `✅ PR merged: ${pr.title}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `✅ *PR Merged*: ${repo} - ${pr.title} (#${pr.number})` },
      },
    ],
  };

  await sendSlackNotification(message);
}

/**
 * Notify on release created
 */
export async function notifyReleaseCreated(repo, release) {
  if (!config.notifyOn.releaseCreated) return;

  const message = {
    text: `🚀 New release: ${repo} ${release.version}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🚀 New Release' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Repository:*\n${repo}` },
          { type: 'mrkdwn', text: `*Version:*\n${release.version}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: release.notes?.substring(0, 500) || '_No release notes_' },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View Release' },
            url: release.url,
          },
        ],
      },
    ],
  };

  await Promise.all([
    sendSlackNotification(message),
    sendDiscordNotification({
      embeds: [{
        title: `🚀 New Release: ${release.version}`,
        color: 0x00ff00,
        description: release.notes?.substring(0, 500),
        fields: [
          { name: 'Repository', value: repo, inline: true },
        ],
        url: release.url,
      }],
    }),
  ]);
}

/**
 * Notify on security alert
 */
export async function notifySecurityAlert(repo, vulnerabilities) {
  if (!config.notifyOn.securityAlert) return;

  const critical = vulnerabilities.filter(v => v.severity === 'critical').length;
  const high = vulnerabilities.filter(v => v.severity === 'high').length;

  const message = {
    text: `🔒 Security Alert: ${repo} has ${vulnerabilities.length} vulnerabilities`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🔒 Security Alert' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Repository:*\n${repo}` },
          { type: 'mrkdwn', text: `*Total:*\n${vulnerabilities.length}` },
          { type: 'mrkdwn', text: `*Critical:*\n${critical}` },
          { type: 'mrkdwn', text: `*High:*\n${high}` },
        ],
      },
    ],
  };

  await sendSlackNotification(message);
}

/**
 * Notify on dependency update PR created
 */
export async function notifyDependencyUpdate(repo, pr, updates) {
  if (!config.notifyOn.dependencyUpdate) return;

  const major = updates.filter(u => u.updateType === 'major').length;
  const minor = updates.filter(u => u.updateType === 'minor').length;
  const patch = updates.filter(u => u.updateType === 'patch').length;

  const message = {
    text: `📦 Dependency update PR created for ${repo}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📦 Dependency Updates' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Repository:*\n${repo}` },
          { type: 'mrkdwn', text: `*PR:*\n#${pr.number}` },
          { type: 'mrkdwn', text: `*Updates:*\n${updates.length} packages` },
          { type: 'mrkdwn', text: `*Breakdown:*\n${major} major, ${minor} minor, ${patch} patch` },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Review PR' },
            url: pr.url,
          },
        ],
      },
    ],
  };

  await sendSlackNotification(message);
}

/**
 * Send a generic notification to all configured channels
 */
export async function notify(message, options = {}) {
  const results = await Promise.all([
    sendSlackNotification(message, options),
    sendDiscordNotification(message, options),
  ]);

  return results.some(r => r);
}

export default {
  sendSlackNotification,
  sendDiscordNotification,
  sendEmailNotification,
  notifyBuildFailure,
  notifyBuildSuccess,
  notifyPROpened,
  notifyPRMerged,
  notifyReleaseCreated,
  notifySecurityAlert,
  notifyDependencyUpdate,
  notify,
};
