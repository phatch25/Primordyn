#!/usr/bin/env node
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';

const dbPath = join(process.cwd(), '.primordyn', 'context.db');

if (!existsSync(dbPath)) {
  console.error('Database not found. Run "primordyn index" first.');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

// Get symbol type distribution
const symbolTypes = db.prepare(`
  SELECT type, COUNT(*) as count 
  FROM symbols 
  GROUP BY type 
  ORDER BY count DESC
`).all();

console.log('\n📊 Symbol Type Distribution:');
console.log('━'.repeat(40));
symbolTypes.forEach(({ type, count }) => {
  const bar = '█'.repeat(Math.ceil(count / 5));
  console.log(`${type.padEnd(12)} ${count.toString().padStart(4)} ${bar}`);
});

// Get files with most symbols
const topFiles = db.prepare(`
  SELECT f.relative_path, COUNT(s.id) as symbol_count
  FROM files f
  JOIN symbols s ON f.id = s.file_id
  GROUP BY f.id
  ORDER BY symbol_count DESC
  LIMIT 10
`).all();

console.log('\n📁 Files with Most Symbols:');
console.log('━'.repeat(40));
topFiles.forEach(({ relative_path, symbol_count }) => {
  console.log(`${symbol_count.toString().padStart(4)} - ${relative_path}`);
});

// Check specific types file
const typesFile = db.prepare(`
  SELECT s.name, s.type, s.signature
  FROM symbols s
  JOIN files f ON s.file_id = f.id
  WHERE f.relative_path = 'src/types/index.ts'
  ORDER BY s.line_start
`).all();

console.log('\n🔍 Symbols in src/types/index.ts:');
console.log('━'.repeat(40));
typesFile.forEach(({ name, type, signature }) => {
  console.log(`[${type}] ${name}`);
  if (signature) console.log(`  └─ ${signature}`);
});

// Count total interfaces/types
const interfaceCount = db.prepare(`
  SELECT COUNT(*) as count FROM symbols WHERE type = 'interface'
`).get();

const typeCount = db.prepare(`
  SELECT COUNT(*) as count FROM symbols WHERE type = 'type'
`).get();

console.log('\n📈 Type System Summary:');
console.log('━'.repeat(40));
console.log(`Interfaces: ${interfaceCount.count}`);
console.log(`Type Aliases: ${typeCount.count}`);

db.close();