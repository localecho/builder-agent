import { exec } from 'child_process';
import { promisify } from 'util';
import { getFileContents } from './github.js';

const execAsync = promisify(exec);

/**
 * Code Quality Scanner
 * Runs linters and reports issues
 */

/**
 * Run ESLint on a local directory
 */
export async function runESLint(repoPath) {
  try {
    const { stdout, stderr } = await execAsync('npx eslint . --format json', {
      cwd: repoPath,
      timeout: 120000,
    });

    return parseESLintOutput(stdout);
  } catch (error) {
    // ESLint exits with code 1 if there are errors
    if (error.stdout) {
      return parseESLintOutput(error.stdout);
    }
    return { success: false, error: error.message, issues: [] };
  }
}

/**
 * Parse ESLint JSON output
 */
function parseESLintOutput(output) {
  try {
    const results = JSON.parse(output);
    const issues = [];

    for (const file of results) {
      for (const message of file.messages) {
        issues.push({
          file: file.filePath,
          line: message.line,
          column: message.column,
          severity: message.severity === 2 ? 'error' : 'warning',
          rule: message.ruleId,
          message: message.message,
        });
      }
    }

    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;

    return {
      success: errors === 0,
      errors,
      warnings,
      issues,
    };
  } catch {
    return { success: false, error: 'Failed to parse ESLint output', issues: [] };
  }
}

/**
 * Run TypeScript compiler for type checking
 */
export async function runTypeScript(repoPath) {
  try {
    const { stdout, stderr } = await execAsync('npx tsc --noEmit 2>&1', {
      cwd: repoPath,
      timeout: 120000,
    });

    return { success: true, errors: 0, issues: [] };
  } catch (error) {
    const issues = parseTypeScriptErrors(error.stdout || error.stderr || '');
    return {
      success: false,
      errors: issues.length,
      issues,
    };
  }
}

/**
 * Parse TypeScript error output
 */
function parseTypeScriptErrors(output) {
  const issues = [];
  const lines = output.split('\n');

  // Pattern: file.ts(line,col): error TS1234: message
  const pattern = /^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      issues.push({
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        severity: match[4],
        code: match[5],
        message: match[6],
      });
    }
  }

  return issues;
}

/**
 * Check for common code quality issues via GitHub API
 */
export async function checkCodeQuality(owner, repo) {
  const results = {
    hasPackageJson: false,
    hasLockFile: false,
    hasESLintConfig: false,
    hasTSConfig: false,
    hasTests: false,
    hasCIConfig: false,
    hasReadme: false,
    hasLicense: false,
    score: 0,
    suggestions: [],
  };

  // Check for essential files
  const checks = [
    { file: 'package.json', key: 'hasPackageJson', weight: 10 },
    { file: 'package-lock.json', key: 'hasLockFile', weight: 5, alt: 'yarn.lock' },
    { file: '.eslintrc.json', key: 'hasESLintConfig', weight: 10, alts: ['.eslintrc.js', '.eslintrc', 'eslint.config.js'] },
    { file: 'tsconfig.json', key: 'hasTSConfig', weight: 10 },
    { file: 'README.md', key: 'hasReadme', weight: 10, alts: ['readme.md', 'README'] },
    { file: 'LICENSE', key: 'hasLicense', weight: 5, alts: ['LICENSE.md', 'license'] },
    { file: '.github/workflows', key: 'hasCIConfig', weight: 15, isDir: true },
  ];

  for (const check of checks) {
    const files = [check.file, ...(check.alts || []), check.alt].filter(Boolean);

    for (const file of files) {
      const content = await getFileContents(owner, repo, file).catch(() => null);
      if (content) {
        results[check.key] = true;
        results.score += check.weight;
        break;
      }
    }

    if (!results[check.key]) {
      results.suggestions.push(`Add ${check.file}`);
    }
  }

  // Check for tests
  const testDirs = ['test', 'tests', '__tests__', 'spec'];
  for (const dir of testDirs) {
    const content = await getFileContents(owner, repo, `${dir}/`).catch(() => null);
    if (content) {
      results.hasTests = true;
      results.score += 15;
      break;
    }
  }

  if (!results.hasTests) {
    // Check for test files in src
    const pkg = await getFileContents(owner, repo, 'package.json').catch(() => null);
    if (pkg) {
      const pkgJson = JSON.parse(pkg.content);
      if (pkgJson.scripts?.test && !pkgJson.scripts.test.includes('no test')) {
        results.hasTests = true;
        results.score += 10;
      }
    }
  }

  if (!results.hasTests) {
    results.suggestions.push('Add tests');
  }

  // Bonus points
  if (results.score >= 50) {
    results.score += 10; // Bonus for having basics covered
  }

  results.score = Math.min(100, results.score);
  results.grade = getGrade(results.score);

  return results;
}

/**
 * Get letter grade from score
 */
function getGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Generate quality report
 */
export function generateQualityReport(results) {
  const lines = [
    '# Code Quality Report',
    '',
    `**Score:** ${results.score}/100 (Grade: ${results.grade})`,
    '',
    '## Checklist',
    '',
    `- [${results.hasPackageJson ? 'x' : ' '}] package.json`,
    `- [${results.hasLockFile ? 'x' : ' '}] Lock file (package-lock.json/yarn.lock)`,
    `- [${results.hasESLintConfig ? 'x' : ' '}] ESLint configuration`,
    `- [${results.hasTSConfig ? 'x' : ' '}] TypeScript configuration`,
    `- [${results.hasTests ? 'x' : ' '}] Tests`,
    `- [${results.hasCIConfig ? 'x' : ' '}] CI/CD configuration`,
    `- [${results.hasReadme ? 'x' : ' '}] README`,
    `- [${results.hasLicense ? 'x' : ' '}] LICENSE`,
    '',
  ];

  if (results.suggestions.length > 0) {
    lines.push('## Suggestions');
    lines.push('');
    for (const suggestion of results.suggestions) {
      lines.push(`- ${suggestion}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export default {
  runESLint,
  runTypeScript,
  checkCodeQuality,
  generateQualityReport,
};
