// Run workspaces (docs/02 §2.5): clone runtime.repo at runtime.branch into an
// isolated per-run directory. checkout: none → neutral tmp cwd (repo-less
// routines); shallow → --depth 1; full → complete history. worktree: every run
// already gets its own directory, so isolation holds; the flag additionally
// keeps the clone after the run for inspection.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sh } from './gh.js';

export async function makeWorkspace(routine, { runId }) {
  const base = mkdtempSync(join(tmpdir(), `harness-ws-${runId}-`));
  if (routine.runtime.checkout === 'none' || !routine.runtime.repo.length) {
    return { dir: base, cloned: [], errors: [], cleanup: () => rm(base) };
  }
  const cloned = [], errors = [];
  for (const repo of routine.runtime.repo) {
    const target = routine.runtime.repo.length > 1 ? join(base, repo.split('/').pop()) : join(base, 'repo');
    const args = ['repo', 'clone', repo, target, '--', '--branch', routine.runtime.branch];
    if (routine.runtime.checkout === 'shallow') args.push('--depth', '1');
    const r = await sh('gh', args, { timeoutMs: 180_000 });
    if (r.code === 0) cloned.push({ repo, dir: target });
    else {
      // fall back to plain git for public repos / non-gh auth setups
      const g = await sh('git', ['clone', ...(routine.runtime.checkout === 'shallow' ? ['--depth', '1'] : []), '--branch', routine.runtime.branch, `https://github.com/${repo}.git`, target], { timeoutMs: 180_000 });
      if (g.code === 0) cloned.push({ repo, dir: target });
      else errors.push({ repo, err: (r.err || g.err).slice(0, 200) });
    }
  }
  const cwd = cloned.length === 1 ? cloned[0].dir : base;
  return { dir: cwd, cloned, errors, cleanup: routine.runtime.worktree ? () => {} : () => rm(base) };
}

const rm = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } };
