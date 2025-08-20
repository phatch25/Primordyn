import { FileScanner } from '../index.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

describe('FileScanner', () => {
  const testDir = join(process.cwd(), '.test-scanner');
  
  beforeEach(() => {
    // Clean up and create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    
    // Create test file structure
    writeFileSync(join(testDir, 'index.ts'), 'export const hello = "world";');
    writeFileSync(join(testDir, 'test.js'), 'console.log("test");');
    writeFileSync(join(testDir, 'README.md'), '# Test Project');
    writeFileSync(join(testDir, '.gitignore'), 'node_modules/\n*.log');
    
    // Create subdirectory with files
    mkdirSync(join(testDir, 'src'));
    writeFileSync(join(testDir, 'src', 'main.ts'), 'function main() { return 42; }');
    writeFileSync(join(testDir, 'src', 'utils.ts'), 'export const utils = {};');
    
    // Create node_modules to test ignore
    mkdirSync(join(testDir, 'node_modules'));
    writeFileSync(join(testDir, 'node_modules', 'package.json'), '{}');
  });
  
  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
  
  test('should scan files in directory', async () => {
    const scanner = new FileScanner({ rootPath: testDir });
    const files = await scanner.scan();
    
    expect(files.length).toBeGreaterThan(0);
    
    // Check that we got the expected files
    const paths = files.map(f => f.relativePath).sort();
    expect(paths).toContain('index.ts');
    expect(paths).toContain('test.js');
    expect(paths).toContain('README.md');
    expect(paths).toContain('src/main.ts');
    expect(paths).toContain('src/utils.ts');
  });
  
  test('should respect gitignore patterns', async () => {
    const scanner = new FileScanner({ rootPath: testDir });
    const files = await scanner.scan();
    
    const paths = files.map(f => f.relativePath);
    // node_modules should be ignored
    expect(paths).not.toContain('node_modules/package.json');
  });
  
  test('should detect languages correctly', async () => {
    const scanner = new FileScanner({ rootPath: testDir });
    const files = await scanner.scan();
    
    const tsFile = files.find(f => f.relativePath === 'index.ts');
    expect(tsFile?.language).toBe('typescript');
    
    const jsFile = files.find(f => f.relativePath === 'test.js');
    expect(jsFile?.language).toBe('javascript');
    
    const mdFile = files.find(f => f.relativePath === 'README.md');
    expect(mdFile?.language).toBe('markdown');
  });
  
  test('should calculate file hash', async () => {
    const scanner = new FileScanner({ rootPath: testDir });
    const files = await scanner.scan();
    
    const file = files.find(f => f.relativePath === 'index.ts');
    expect(file?.hash).toBeTruthy();
    expect(file?.hash.length).toBeGreaterThan(0);
  });
  
  test('should filter by language patterns', async () => {
    const scanner = new FileScanner({ 
      rootPath: testDir,
      includePatterns: ['typescript']
    });
    const files = await scanner.scan();
    
    // Should only get TypeScript files
    const languages = [...new Set(files.map(f => f.language))];
    expect(languages).toEqual(['typescript']);
  });
  
  test('should respect max file size', async () => {
    // Create a large file
    const largeContent = 'x'.repeat(1000);
    writeFileSync(join(testDir, 'large.txt'), largeContent);
    
    const scanner = new FileScanner({ 
      rootPath: testDir,
      maxFileSize: 500 // 500 bytes
    });
    const files = await scanner.scan();
    
    // Large file should be excluded
    const paths = files.map(f => f.relativePath);
    expect(paths).not.toContain('large.txt');
  });
});