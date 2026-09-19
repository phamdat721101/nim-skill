/**
 * src/search/ast-symbols.ts
 * --------------------------
 * Symbol extraction for the AS-SCP graph engine. For .ts/.tsx/.js/.mts/.cts
 * files, uses the real TypeScript AST (same `ts.createSourceFile` technique
 * as src/architect/index.ts) to extract exported top-level declarations plus
 * one level of class-member methods, each with a 1-indexed line range and a
 * sha256 digest of its source-text slice. For every other extension, a
 * regex-based fallback extractor (`extractSymbolsFallback`) tags each result
 * `confidence: 'low'` — a best-effort signal, not an AST-verified one.
 */

import { createHash } from 'node:crypto';
import ts from 'typescript';

export type AstSymbolKind = 'class' | 'interface' | 'function' | 'type' | 'variable' | 'method';

export interface AstSymbol {
  name: string;
  kind: AstSymbolKind;
  lineStart: number;
  lineEnd: number;
  isExported: boolean;
  digestSha256: string;
  /** Only ever set (to 'low') by the regex-based fallback extractor. */
  confidence?: 'low';
}

const TS_EXTENSIONS = /\.(tsx?|mts|cts|jsx?)$/;

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function lineRange(node: ts.Node, source: ts.SourceFile): { lineStart: number; lineEnd: number } {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const end = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  return { lineStart: start, lineEnd: end };
}

function isExportedNode(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

function sliceOf(node: ts.Node, source: ts.SourceFile): string {
  return source.text.slice(node.getStart(source), node.getEnd());
}

function pushSymbol(
  out: AstSymbol[],
  node: ts.Node,
  source: ts.SourceFile,
  name: string,
  kind: AstSymbolKind,
  isExported: boolean,
): void {
  const { lineStart, lineEnd } = lineRange(node, source);
  out.push({ name, kind, lineStart, lineEnd, isExported, digestSha256: digestOf(sliceOf(node, source)) });
}

function visitClassMembers(classNode: ts.ClassDeclaration, source: ts.SourceFile, classExported: boolean, out: AstSymbol[]): void {
  for (const member of classNode.members) {
    if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      pushSymbol(out, member, source, member.name.text, 'method', classExported);
    }
  }
}

/** Real AST-backed extraction for TypeScript/JavaScript sources. */
export function extractSymbols(filePath: string, source: string): AstSymbol[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const out: AstSymbol[] = [];

  for (const statement of sourceFile.statements) {
    const exported = isExportedNode(statement);

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      pushSymbol(out, statement, sourceFile, statement.name.text, 'function', exported);
      continue;
    }

    if (ts.isClassDeclaration(statement) && statement.name) {
      pushSymbol(out, statement, sourceFile, statement.name.text, 'class', exported);
      visitClassMembers(statement, sourceFile, exported, out);
      continue;
    }

    if (ts.isInterfaceDeclaration(statement)) {
      pushSymbol(out, statement, sourceFile, statement.name.text, 'interface', exported);
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement)) {
      pushSymbol(out, statement, sourceFile, statement.name.text, 'type', exported);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          pushSymbol(out, statement, sourceFile, decl.name.text, 'variable', exported);
        }
      }
      continue;
    }
  }

  return out;
}

interface FallbackRule {
  kind: AstSymbolKind;
  regex: RegExp;
}

/**
 * Regex rules covering: Python `def`/`class`, Go `func`, Rust `fn`,
 * JS/TS-style `function`, and Solidity `contract`. Matched per-line so line
 * numbers are exact; each match yields a `confidence: 'low'` symbol whose
 * `lineEnd` equals `lineStart` (fallback extraction has no reliable body-end
 * detection without a real parser).
 */
const FALLBACK_RULES: FallbackRule[] = [
  { kind: 'function', regex: /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/ },
  { kind: 'class', regex: /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/ },
  { kind: 'function', regex: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/ },
  { kind: 'function', regex: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/ },
  { kind: 'function', regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/ },
  { kind: 'class', regex: /^\s*(?:abstract\s+)?contract\s+([A-Za-z_][A-Za-z0-9_]*)/ },
];

/** Best-effort, regex-based extractor for non-TS languages (.py/.go/.rs/.sol/etc). Always tags `confidence: 'low'`. */
export function extractSymbolsFallback(_filePath: string, source: string): AstSymbol[] {
  const out: AstSymbol[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const rule of FALLBACK_RULES) {
      const match = rule.regex.exec(line);
      if (match?.[1]) {
        const lineNumber = i + 1;
        out.push({
          name: match[1],
          kind: rule.kind,
          lineStart: lineNumber,
          lineEnd: lineNumber,
          isExported: true,
          digestSha256: digestOf(line),
          confidence: 'low',
        });
        break;
      }
    }
  }
  return out;
}

/** Dispatches to the real AST extractor for TS/JS files, else the regex fallback. */
export function extractAnySymbols(filePath: string, source: string): AstSymbol[] {
  return TS_EXTENSIONS.test(filePath) ? extractSymbols(filePath, source) : extractSymbolsFallback(filePath, source);
}
