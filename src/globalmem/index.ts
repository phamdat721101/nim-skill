import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../security/content-hash.js';
import type { DriftReport, GlobalMemoryDeclaration } from './types.js';

export interface GlobalMemoryAuditor { audit(declaration: GlobalMemoryDeclaration, contentByPath: Record<string, string>): DriftReport; auditFiles(declaration: GlobalMemoryDeclaration): DriftReport; }

export function createGlobalMemoryAuditor(): GlobalMemoryAuditor {
  const audit = (declaration: GlobalMemoryDeclaration, contentByPath: Record<string, string>): DriftReport => {
    const hashes: Record<string, string> = {};
    for (const path of declaration.paths) {
      if (!(path in contentByPath)) throw new Error(`missing content for declared path: ${path}`);
      hashes[path] = sha256(contentByPath[path]!);
    }
    const counts = new Map<string, number>();
    for (const hash of Object.values(hashes)) counts.set(hash, (counts.get(hash) ?? 0) + 1);
    const reference = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    const divergentPaths = declaration.paths.filter((path) => hashes[path] !== reference);
    return { name: declaration.name, paths: [...declaration.paths], hashes, inSync: divergentPaths.length === 0, ...(divergentPaths.length ? { divergentPaths } : {}) };
  };
  return { audit, auditFiles: (declaration) => {
    const contents: Record<string, string> = {};
    for (const declaredPath of declaration.paths) {
      const path = declaredPath === '~' ? homedir() : declaredPath.startsWith('~/') ? join(homedir(), declaredPath.slice(2)) : declaredPath;
      if (!existsSync(path)) throw new Error(`declared global memory file does not exist: ${declaredPath}`);
      contents[declaredPath] = readFileSync(path, 'utf8');
    }
    return audit(declaration, contents);
  } };
}

export type { DriftReport, GlobalMemoryDeclaration } from './types.js';
