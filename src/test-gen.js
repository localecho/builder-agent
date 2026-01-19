/**
 * Test Generation Module
 * Generates test scaffolds for code files
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

/**
 * Detect testing framework from package.json
 */
export function detectTestFramework(packageJsonPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['vitest']) return 'vitest';
    if (deps['jest']) return 'jest';
    if (deps['mocha']) return 'mocha';
    if (deps['ava']) return 'ava';
    if (deps['tap']) return 'tap';

    return 'jest'; // default
  } catch {
    return 'jest';
  }
}

/**
 * Parse a JavaScript/TypeScript file for functions and classes
 */
export function parseCodeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath);
  const isTS = ext === '.ts' || ext === '.tsx';

  const exports = [];

  // Match exported functions
  const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = funcRegex.exec(content)) !== null) {
    exports.push({
      type: 'function',
      name: match[1],
      params: parseParams(match[2]),
      async: content.substring(match.index, match.index + 30).includes('async'),
    });
  }

  // Match exported arrow functions
  const arrowRegex = /export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*[^=]+)?\s*=>/g;
  while ((match = arrowRegex.exec(content)) !== null) {
    exports.push({
      type: 'function',
      name: match[1],
      params: parseParams(match[2]),
      async: content.substring(match.index, match.index + 50).includes('async'),
    });
  }

  // Match exported classes
  const classRegex = /export\s+class\s+(\w+)/g;
  while ((match = classRegex.exec(content)) !== null) {
    exports.push({
      type: 'class',
      name: match[1],
      methods: parseClassMethods(content, match[1]),
    });
  }

  // Match default export
  const defaultRegex = /export\s+default\s+(?:function\s+)?(\w+)/;
  const defaultMatch = content.match(defaultRegex);
  if (defaultMatch) {
    exports.push({
      type: 'default',
      name: defaultMatch[1],
    });
  }

  return {
    filePath,
    isTS,
    exports,
    hasJSX: ext === '.jsx' || ext === '.tsx',
  };
}

function parseParams(paramString) {
  if (!paramString.trim()) return [];
  return paramString.split(',').map(p => {
    const [name] = p.trim().split(':');
    return name.trim().replace(/[?=].*/, '');
  }).filter(Boolean);
}

function parseClassMethods(content, className) {
  const methods = [];
  const methodRegex = /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*\{/g;
  let match;
  while ((match = methodRegex.exec(content)) !== null) {
    if (match[1] !== 'constructor' && !match[1].startsWith('_')) {
      methods.push({
        name: match[1],
        params: parseParams(match[2]),
        async: content.substring(match.index - 10, match.index).includes('async'),
      });
    }
  }
  return methods.slice(0, 10); // Limit to first 10 methods
}

/**
 * Generate test file content
 */
export function generateTestContent(parsed, framework = 'jest') {
  const { filePath, isTS, exports, hasJSX } = parsed;
  const relativePath = './' + path.basename(filePath).replace(/\.(test|spec)\.[jt]sx?$/, '').replace(/\.[jt]sx?$/, '');
  const ext = isTS ? '.ts' : '.js';

  const importNames = exports
    .filter(e => e.type !== 'default')
    .map(e => e.name);

  const defaultExport = exports.find(e => e.type === 'default');

  let content = '';

  // Imports
  if (framework === 'vitest') {
    content += `import { describe, it, expect, beforeEach } from 'vitest';\n`;
  }

  const imports = [];
  if (defaultExport) imports.push(defaultExport.name);
  if (importNames.length > 0) imports.push(`{ ${importNames.join(', ')} }`);

  if (imports.length > 0) {
    content += `import ${imports.join(', ')} from '${relativePath}';\n`;
  }

  content += '\n';

  // Generate test suites
  for (const exp of exports) {
    if (exp.type === 'function') {
      content += generateFunctionTests(exp, framework);
    } else if (exp.type === 'class') {
      content += generateClassTests(exp, framework);
    }
  }

  return content;
}

function generateFunctionTests(func, framework) {
  const { name, params, async: isAsync } = func;
  const asyncPrefix = isAsync ? 'async ' : '';
  const awaitPrefix = isAsync ? 'await ' : '';

  let content = `describe('${name}', () => {\n`;

  // Basic test case
  content += `  it('should work with valid input', ${asyncPrefix}() => {\n`;
  if (params.length > 0) {
    content += `    // Arrange\n`;
    params.forEach(p => {
      content += `    const ${p} = undefined; // TODO: provide test value\n`;
    });
    content += `\n    // Act\n`;
    content += `    const result = ${awaitPrefix}${name}(${params.join(', ')});\n`;
  } else {
    content += `    const result = ${awaitPrefix}${name}();\n`;
  }
  content += `\n    // Assert\n`;
  content += `    expect(result).toBeDefined();\n`;
  content += `  });\n\n`;

  // Edge case test
  content += `  it('should handle edge cases', ${asyncPrefix}() => {\n`;
  content += `    // TODO: Add edge case tests\n`;
  content += `    expect(true).toBe(true);\n`;
  content += `  });\n\n`;

  // Error case test
  content += `  it('should handle errors gracefully', ${asyncPrefix}() => {\n`;
  content += `    // TODO: Add error handling tests\n`;
  content += `    expect(true).toBe(true);\n`;
  content += `  });\n`;

  content += `});\n\n`;

  return content;
}

function generateClassTests(cls, framework) {
  const { name, methods } = cls;

  let content = `describe('${name}', () => {\n`;
  content += `  let instance;\n\n`;

  content += `  beforeEach(() => {\n`;
  content += `    instance = new ${name}(); // TODO: provide constructor args if needed\n`;
  content += `  });\n\n`;

  for (const method of methods) {
    const asyncPrefix = method.async ? 'async ' : '';
    const awaitPrefix = method.async ? 'await ' : '';

    content += `  describe('${method.name}', () => {\n`;
    content += `    it('should work correctly', ${asyncPrefix}() => {\n`;

    if (method.params.length > 0) {
      method.params.forEach(p => {
        content += `      const ${p} = undefined; // TODO: provide test value\n`;
      });
      content += `      const result = ${awaitPrefix}instance.${method.name}(${method.params.join(', ')});\n`;
    } else {
      content += `      const result = ${awaitPrefix}instance.${method.name}();\n`;
    }
    content += `      expect(result).toBeDefined();\n`;
    content += `    });\n`;
    content += `  });\n\n`;
  }

  content += `});\n\n`;

  return content;
}

/**
 * Generate test file for a source file
 */
export function generateTestFile(sourcePath, options = {}) {
  const {
    outputDir,
    framework = 'jest',
    suffix = '.test',
  } = options;

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  const parsed = parseCodeFile(sourcePath);

  if (parsed.exports.length === 0) {
    return { skipped: true, reason: 'No exports found' };
  }

  const content = generateTestContent(parsed, framework);

  // Determine output path
  const ext = path.extname(sourcePath);
  const baseName = path.basename(sourcePath, ext);
  const testFileName = `${baseName}${suffix}${ext}`;

  let testPath;
  if (outputDir) {
    testPath = path.join(outputDir, testFileName);
  } else {
    // Put test file next to source file
    testPath = path.join(path.dirname(sourcePath), testFileName);
  }

  // Check if test already exists
  if (fs.existsSync(testPath)) {
    return { skipped: true, reason: 'Test file already exists', path: testPath };
  }

  fs.writeFileSync(testPath, content);

  return {
    created: true,
    path: testPath,
    exports: parsed.exports.length,
    framework,
  };
}

/**
 * Generate tests for all files in a directory
 */
export function generateTestsForDirectory(dir, options = {}) {
  const results = [];
  const extensions = ['.js', '.ts', '.jsx', '.tsx'];

  function scanDir(currentDir) {
    const items = fs.readdirSync(currentDir);

    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip common non-source directories
        if (!['node_modules', '.git', 'dist', 'build', '__tests__', '.next'].includes(item)) {
          scanDir(fullPath);
        }
      } else if (stat.isFile()) {
        const ext = path.extname(item);
        // Skip test files and non-source files
        if (
          extensions.includes(ext) &&
          !item.includes('.test.') &&
          !item.includes('.spec.') &&
          !item.startsWith('_')
        ) {
          try {
            const result = generateTestFile(fullPath, options);
            results.push({ file: fullPath, ...result });
          } catch (error) {
            results.push({ file: fullPath, error: error.message });
          }
        }
      }
    }
  }

  scanDir(dir);
  return results;
}

/**
 * Print test generation summary
 */
export function printTestGenSummary(results) {
  const created = results.filter(r => r.created);
  const skipped = results.filter(r => r.skipped);
  const errors = results.filter(r => r.error);

  console.log(chalk.blue('\n📝 Test Generation Summary\n'));

  if (created.length > 0) {
    console.log(chalk.green(`✓ Created ${created.length} test file(s):`));
    created.forEach(r => {
      console.log(chalk.gray(`  ${r.path} (${r.exports} exports)`));
    });
    console.log();
  }

  if (skipped.length > 0) {
    console.log(chalk.yellow(`⊘ Skipped ${skipped.length} file(s):`));
    skipped.forEach(r => {
      console.log(chalk.gray(`  ${r.file || r.path}: ${r.reason}`));
    });
    console.log();
  }

  if (errors.length > 0) {
    console.log(chalk.red(`✗ Errors with ${errors.length} file(s):`));
    errors.forEach(r => {
      console.log(chalk.gray(`  ${r.file}: ${r.error}`));
    });
    console.log();
  }

  return { created: created.length, skipped: skipped.length, errors: errors.length };
}
