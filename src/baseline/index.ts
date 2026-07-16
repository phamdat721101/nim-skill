/**
 * src/baseline/index.ts
 * ----------------------
 * `createBaselineLinter(cfg)` — public factory composing the 6 rules into
 * `lint(text)` and `audit(dir)`. All rules are advisory (`CheckResult.pass`
 * false ⇒ a finding, never a thrown error) — the CLI decides strict/warn/off
 * behavior from `cfg.mode`, matching the existing `EnforceMode` vocabulary.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckResult } from '../harness/types.js';
import { checkLen, checkBudget, checkDerivable, checkLintable, checkTaskSpecific, checkProgressive } from './rules.js';
import { DERIVABLE_PHRASES, LINTABLE_PHRASES, TASKSPECIFIC_STOPWORDS } from './generic-phrases.js';

export interface BaselineConfig {
  maxLines: number;
  blockLines: number;
  maxInstructions: number;
  mode: 'warn' | 'strict' | 'off';
  detailDir: string;
}

const LINT_CONFIG_FILES = ['.eslintrc', '.eslintrc.json', '.eslintrc.js', '.prettierrc', '.prettierrc.json', 'pyproject.toml'];

/** Heuristic: does the project (cwd) have a detected lint/format config? */
function detectLintConfig(root: string = process.cwd()): boolean {
  return LINT_CONFIG_FILES.some((f) => existsSync(join(root, f)));
}

export function createBaselineLinter(cfg: BaselineConfig): {
  lint(text: string): CheckResult[];
  audit(dir: string): CheckResult[];
} {
  return {
    lint(text: string): CheckResult[] {
      const hasLintConfig = detectLintConfig();
      return [
        checkLen(text, cfg),
        checkBudget(text, cfg),
        checkDerivable(text, DERIVABLE_PHRASES),
        checkLintable(text, LINTABLE_PHRASES, hasLintConfig),
        checkTaskSpecific(text, TASKSPECIFIC_STOPWORDS),
        ...checkProgressive(text, cfg),
      ];
    },
    audit(dir: string): CheckResult[] {
      // BL-EMPTYFOLDER (directory-aware half): a detail dir that exists but has
      // no files, or is referenced but missing entirely, is flagged here — the
      // pure checkProgressive() cannot see the filesystem.
      const detailPath = join(dir, cfg.detailDir);
      if (!existsSync(detailPath)) {
        return [{ strategy: 'BL-EMPTYFOLDER', pass: true, reason: `no '${cfg.detailDir}/' directory present (fine if not yet needed)` }];
      }
      const entries = readdirSync(detailPath);
      return [
        {
          strategy: 'BL-EMPTYFOLDER',
          pass: entries.length > 0,
          reason: entries.length > 0 ? undefined : `'${cfg.detailDir}/' exists but is empty — an orphaned detail-file directory`,
        },
      ];
    },
  };
}
