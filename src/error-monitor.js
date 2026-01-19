/**
 * Error Monitoring Integration Module
 * Aggregates and tracks errors from various sources
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const ERRORS_FILE = path.join(DATA_DIR, 'errors.json');
const CONFIG_FILE = path.join(DATA_DIR, 'error-config.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Error severity levels
 */
export const ErrorSeverity = {
  DEBUG: 'debug',
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
};

/**
 * Load error configuration
 */
export function loadErrorConfig() {
  const defaults = {
    sources: [],
    alertThreshold: 10,      // Alert after this many errors in window
    windowMinutes: 60,       // Error counting window
    silenceMinutes: 15,      // Don't re-alert for same error type
    severityFilter: ['error', 'critical'],
    slackWebhook: null,
    emailRecipients: []
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
    }
  } catch {
    // Use defaults
  }

  return defaults;
}

/**
 * Save error configuration
 */
export function saveErrorConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Load error log
 */
function loadErrors() {
  try {
    if (fs.existsSync(ERRORS_FILE)) {
      return JSON.parse(fs.readFileSync(ERRORS_FILE, 'utf-8'));
    }
  } catch {
    // Return empty
  }
  return [];
}

/**
 * Save error log
 */
function saveErrors(errors) {
  // Keep last 1000 errors
  const trimmed = errors.slice(-1000);
  fs.writeFileSync(ERRORS_FILE, JSON.stringify(trimmed, null, 2));
}

/**
 * Log an error
 */
export function logError(error) {
  const errors = loadErrors();

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    severity: error.severity || ErrorSeverity.ERROR,
    source: error.source || 'unknown',
    message: error.message,
    stack: error.stack,
    context: error.context || {},
    fingerprint: generateFingerprint(error),
    acknowledged: false
  };

  errors.push(entry);
  saveErrors(errors);

  // Check for alert threshold
  checkAlertThreshold(entry);

  return entry;
}

/**
 * Generate error fingerprint for deduplication
 */
function generateFingerprint(error) {
  const parts = [
    error.source || '',
    error.message?.substring(0, 100) || '',
    error.severity || ''
  ];
  return Buffer.from(parts.join('|')).toString('base64').substring(0, 16);
}

/**
 * Check if alert threshold is reached
 */
function checkAlertThreshold(newError) {
  const config = loadErrorConfig();
  const errors = loadErrors();
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.windowMinutes * 60 * 1000);

  // Count errors in window
  const recentErrors = errors.filter(e =>
    new Date(e.timestamp) >= windowStart &&
    config.severityFilter.includes(e.severity)
  );

  if (recentErrors.length >= config.alertThreshold) {
    // Check silence period for this fingerprint
    const lastAlert = getLastAlert(newError.fingerprint);
    if (!lastAlert || (now - new Date(lastAlert)) > config.silenceMinutes * 60 * 1000) {
      triggerAlert(recentErrors, config);
    }
  }
}

/**
 * Get last alert time for a fingerprint
 */
function getLastAlert(fingerprint) {
  const alertsFile = path.join(DATA_DIR, 'error-alerts.json');
  try {
    if (fs.existsSync(alertsFile)) {
      const alerts = JSON.parse(fs.readFileSync(alertsFile, 'utf-8'));
      return alerts[fingerprint];
    }
  } catch {
    // No alerts file
  }
  return null;
}

/**
 * Record alert time
 */
function recordAlert(fingerprint) {
  const alertsFile = path.join(DATA_DIR, 'error-alerts.json');
  let alerts = {};

  try {
    if (fs.existsSync(alertsFile)) {
      alerts = JSON.parse(fs.readFileSync(alertsFile, 'utf-8'));
    }
  } catch {
    // Start fresh
  }

  alerts[fingerprint] = new Date().toISOString();
  fs.writeFileSync(alertsFile, JSON.stringify(alerts, null, 2));
}

/**
 * Trigger alert (console for now, can be extended to Slack/email)
 */
function triggerAlert(errors, config) {
  console.log('\n🚨 ERROR ALERT: ' + errors.length + ' errors in last ' + config.windowMinutes + ' minutes');

  // Group by fingerprint
  const byFingerprint = {};
  for (const error of errors) {
    if (!byFingerprint[error.fingerprint]) {
      byFingerprint[error.fingerprint] = [];
    }
    byFingerprint[error.fingerprint].push(error);
  }

  for (const [fp, fpErrors] of Object.entries(byFingerprint)) {
    const sample = fpErrors[0];
    console.log(`  [${sample.severity.toUpperCase()}] ${sample.source}: ${sample.message} (${fpErrors.length}x)`);
    recordAlert(fp);
  }
}

/**
 * Get error summary
 */
export function getErrorSummary(options = {}) {
  const { hours = 24, severity = null, source = null } = options;

  const errors = loadErrors();
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  let filtered = errors.filter(e => new Date(e.timestamp) >= cutoff);

  if (severity) {
    filtered = filtered.filter(e => e.severity === severity);
  }
  if (source) {
    filtered = filtered.filter(e => e.source === source);
  }

  // Group by severity
  const bySeverity = {};
  const bySource = {};
  const byFingerprint = {};

  for (const error of filtered) {
    bySeverity[error.severity] = (bySeverity[error.severity] || 0) + 1;
    bySource[error.source] = (bySource[error.source] || 0) + 1;
    byFingerprint[error.fingerprint] = (byFingerprint[error.fingerprint] || 0) + 1;
  }

  // Find most frequent errors
  const topErrors = Object.entries(byFingerprint)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([fp, count]) => {
      const sample = filtered.find(e => e.fingerprint === fp);
      return { fingerprint: fp, count, sample };
    });

  return {
    totalErrors: filtered.length,
    period: { hours, from: cutoff.toISOString() },
    bySeverity,
    bySource,
    topErrors,
    timestamp: new Date().toISOString()
  };
}

/**
 * Format error summary report
 */
export function formatErrorReport(summary) {
  const lines = [
    '╔═══════════════════════════════════════════════════════════════╗',
    '║                    ERROR MONITORING REPORT                    ║',
    '╠═══════════════════════════════════════════════════════════════╣',
    `║ Period: Last ${summary.period.hours} hours`.padEnd(64) + '║',
    `║ Total Errors: ${summary.totalErrors}`.padEnd(64) + '║',
    '╠═══════════════════════════════════════════════════════════════╣',
    '║                      BY SEVERITY                              ║',
    '╠═══════════════════════════════════════════════════════════════╣',
  ];

  const severityIcons = {
    critical: '🔴',
    error: '🟠',
    warning: '🟡',
    info: '🔵',
    debug: '⚪'
  };

  for (const [sev, count] of Object.entries(summary.bySeverity).sort((a, b) => b[1] - a[1])) {
    const icon = severityIcons[sev] || '⚪';
    lines.push(`║ ${icon} ${sev.padEnd(12)} ${count}`.padEnd(64) + '║');
  }

  if (Object.keys(summary.bySource).length > 0) {
    lines.push('╠═══════════════════════════════════════════════════════════════╣');
    lines.push('║                      BY SOURCE                                ║');
    lines.push('╠═══════════════════════════════════════════════════════════════╣');

    for (const [src, count] of Object.entries(summary.bySource).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      lines.push(`║   ${src.padEnd(20)} ${count}`.padEnd(64) + '║');
    }
  }

  if (summary.topErrors.length > 0) {
    lines.push('╠═══════════════════════════════════════════════════════════════╣');
    lines.push('║                    TOP ERRORS                                 ║');
    lines.push('╠═══════════════════════════════════════════════════════════════╣');

    for (const { count, sample } of summary.topErrors) {
      const msg = sample.message.substring(0, 40);
      lines.push(`║ (${count}x) ${sample.source}: ${msg}...`.padEnd(64) + '║');
    }
  }

  lines.push('╚═══════════════════════════════════════════════════════════════╝');

  return lines.join('\n');
}

/**
 * Acknowledge error
 */
export function acknowledgeError(errorId) {
  const errors = loadErrors();
  const error = errors.find(e => e.id === errorId);

  if (error) {
    error.acknowledged = true;
    error.acknowledgedAt = new Date().toISOString();
    saveErrors(errors);
    return error;
  }

  return null;
}

/**
 * Get unacknowledged errors
 */
export function getUnacknowledgedErrors(options = {}) {
  const { severity = null, limit = 20 } = options;

  let errors = loadErrors().filter(e => !e.acknowledged);

  if (severity) {
    errors = errors.filter(e => e.severity === severity);
  }

  return errors.slice(-limit);
}

/**
 * Simulate some test errors
 */
export function seedTestErrors() {
  const sources = ['api-server', 'web-client', 'worker', 'database', 'cache'];
  const messages = [
    'Connection timeout exceeded',
    'Invalid JSON response',
    'Rate limit exceeded',
    'Authentication failed',
    'Resource not found',
    'Out of memory',
    'Disk space low',
    'SSL certificate expired'
  ];
  const severities = ['error', 'warning', 'critical', 'error', 'error'];

  const errors = [];
  for (let i = 0; i < 25; i++) {
    const entry = logError({
      source: sources[Math.floor(Math.random() * sources.length)],
      message: messages[Math.floor(Math.random() * messages.length)],
      severity: severities[Math.floor(Math.random() * severities.length)],
      context: { requestId: 'req-' + Math.random().toString(36).slice(2, 8) }
    });
    errors.push(entry);
  }

  return errors.length;
}
