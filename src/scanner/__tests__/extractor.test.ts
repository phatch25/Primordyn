import { ContextExtractor } from '../extractor.js';
import type { FileInfo } from '../../types/index.js';

describe('ContextExtractor', () => {
  test('should extract TypeScript symbols', () => {
    const fileInfo: FileInfo = {
      path: '/test/file.ts',
      relativePath: 'file.ts',
      content: `
export class TestClass {
  private value: number;
  
  constructor(value: number) {
    this.value = value;
  }
  
  public getValue(): number {
    return this.value;
  }
}

export function testFunction(param: string): string {
  return param.toUpperCase();
}

export const testConstant = 42;

interface TestInterface {
  id: number;
  name: string;
}
      `.trim(),
      hash: 'test-hash',
      size: 100,
      language: 'typescript',
      lastModified: new Date()
    };
    
    const extractor = new ContextExtractor(fileInfo);
    const context = extractor.extract();
    
    // Check symbols were extracted
    expect(context.symbols.length).toBeGreaterThan(0);
    
    // Check class was found
    const classSymbol = context.symbols.find(s => s.name === 'TestClass');
    expect(classSymbol).toBeTruthy();
    expect(classSymbol?.type).toBe('class');
    
    // Check function was found
    const funcSymbol = context.symbols.find(s => s.name === 'testFunction');
    expect(funcSymbol).toBeTruthy();
    expect(funcSymbol?.type).toBe('function');
    
    // Check interface was found
    const interfaceSymbol = context.symbols.find(s => s.name === 'TestInterface');
    expect(interfaceSymbol).toBeTruthy();
    expect(interfaceSymbol?.type).toBe('interface');
    
    // Check exports
    expect(context.exports).toContain('TestClass');
    expect(context.exports).toContain('testFunction');
    expect(context.exports).toContain('testConstant');
  });
  
  test('should extract JavaScript symbols', () => {
    const fileInfo: FileInfo = {
      path: '/test/file.js',
      relativePath: 'file.js',
      content: `
function normalFunction() {
  return 'hello';
}

const arrowFunction = () => {
  return 'world';
};

class MyClass {
  constructor() {
    this.prop = 1;
  }
  
  method() {
    return this.prop;
  }
}

module.exports = {
  normalFunction,
  arrowFunction,
  MyClass
};
      `.trim(),
      hash: 'test-hash',
      size: 100,
      language: 'javascript',
      lastModified: new Date()
    };
    
    const extractor = new ContextExtractor(fileInfo);
    const context = extractor.extract();
    
    // Check function extraction
    const funcSymbol = context.symbols.find(s => s.name === 'normalFunction');
    expect(funcSymbol).toBeTruthy();
    expect(funcSymbol?.type).toBe('function');
    
    // Check arrow function extraction
    const arrowSymbol = context.symbols.find(s => s.name === 'arrowFunction');
    expect(arrowSymbol).toBeTruthy();
    
    // Check class extraction
    const classSymbol = context.symbols.find(s => s.name === 'MyClass');
    expect(classSymbol).toBeTruthy();
    expect(classSymbol?.type).toBe('class');
  });
  
  test('should extract Python symbols using regex', () => {
    const fileInfo: FileInfo = {
      path: '/test/file.py',
      relativePath: 'file.py',
      content: `
class PythonClass:
    def __init__(self, value):
        self.value = value
    
    def get_value(self):
        return self.value

def python_function(param):
    return param.upper()

async def async_function():
    await some_operation()
    return True

CONSTANT_VALUE = 42
      `.trim(),
      hash: 'test-hash',
      size: 100,
      language: 'python',
      lastModified: new Date()
    };
    
    const extractor = new ContextExtractor(fileInfo);
    const context = extractor.extract();
    
    // Check class extraction
    const classSymbol = context.symbols.find(s => s.name === 'PythonClass');
    expect(classSymbol).toBeTruthy();
    expect(classSymbol?.type).toBe('class');
    
    // Check function extraction
    const funcSymbol = context.symbols.find(s => s.name === 'python_function');
    expect(funcSymbol).toBeTruthy();
    expect(funcSymbol?.type).toBe('function');
    
    // Check async function extraction
    const asyncSymbol = context.symbols.find(s => s.name === 'async_function');
    expect(asyncSymbol).toBeTruthy();
    expect(asyncSymbol?.type).toBe('function');
  });
  
  test('should extract imports', () => {
    const fileInfo: FileInfo = {
      path: '/test/file.ts',
      relativePath: 'file.ts',
      content: `
import { Component } from 'react';
import * as fs from 'fs';
import defaultExport from './module';
const dynamicImport = require('dynamic-module');

export class MyComponent extends Component {
  render() {
    return null;
  }
}
      `.trim(),
      hash: 'test-hash',
      size: 100,
      language: 'typescript',
      lastModified: new Date()
    };
    
    const extractor = new ContextExtractor(fileInfo);
    const context = extractor.extract();
    
    // Check imports
    expect(context.imports).toContain('react');
    expect(context.imports).toContain('fs');
    expect(context.imports).toContain('./module');
    expect(context.imports).toContain('dynamic-module');
  });
  
  test('should extract call references', () => {
    const fileInfo: FileInfo = {
      path: '/test/file.ts',
      relativePath: 'file.ts',
      content: `
import { helper } from './helper';

function main() {
  const result = helper();
  console.log(result);
  processData(result);
  return new MyClass();
}

function processData(data) {
  return data.map(item => item.value);
}
      `.trim(),
      hash: 'test-hash',
      size: 100,
      language: 'typescript',
      lastModified: new Date()
    };
    
    const extractor = new ContextExtractor(fileInfo);
    const context = extractor.extract();
    
    // Check call references
    expect(context.calls.length).toBeGreaterThan(0);
    
    const helperCall = context.calls.find(c => c.calleeName === 'helper');
    expect(helperCall).toBeTruthy();
    expect(helperCall?.callType).toBe('function');
    
    const consoleCall = context.calls.find(c => c.calleeName === 'console.log');
    expect(consoleCall).toBeTruthy();
    
    const constructorCall = context.calls.find(c => c.calleeName === 'MyClass');
    expect(constructorCall).toBeTruthy();
    expect(constructorCall?.callType).toBe('constructor');
  });
});