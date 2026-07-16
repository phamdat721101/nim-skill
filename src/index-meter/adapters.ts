/**
 * src/index-meter/adapters.ts
 * -----------------------------
 * Read either input shape nim-index accepts — an MCP client config
 * (`tools/list`-shaped) or a `skills/*\/SKILL.md` tree — and reduce both to
 * the same `ToolManifestEntry[]`. All file I/O lives here; estimate.ts and
 * volatility.ts stay pure.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolManifestEntry } from './types.js';

/** Read an MCP client config file (a list of servers, each with a `tools` array). */
export function readMcpConfig(path: string): ToolManifestEntry[] {
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers?: Record<string, { tools?: ToolManifestEntry[] }> };
  const servers = raw.mcpServers ?? {};
  return Object.values(servers).flatMap((s) => s.tools ?? []);
}

/** Extract a SKILL.md's frontmatter `description` (the disclosed "tool description"). */
function extractDescription(md: string): string {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  const fm = match?.[1] ?? '';
  const descMatch = fm.match(/description:\s*\|?\s*\n?([\s\S]*?)(?=\n\w+:|$)/);
  return descMatch?.[1]?.trim() ?? '';
}

/** Read a `skills/*\/SKILL.md` tree into ToolManifestEntry[] — one entry per skill folder. */
export function readSkillsDir(path: string): ToolManifestEntry[] {
  if (!existsSync(path)) return [];
  const entries: ToolManifestEntry[] = [];
  for (const name of readdirSync(path)) {
    const skillFile = join(path, name, 'SKILL.md');
    if (existsSync(skillFile) && statSync(skillFile).isFile()) {
      entries.push({ name, description: extractDescription(readFileSync(skillFile, 'utf8')) });
    }
  }
  return entries;
}
