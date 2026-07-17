/**
 * Acceptance tests for verify-composition.mjs.
 *
 * Zero-dependency: uses node:test + node:assert and drives the real script over
 * system Chrome. If no Chrome is available the whole suite skips cleanly (so CI
 * without a browser is green rather than red).
 *
 * Run:  node --test plugin/skills/website/scripts/test/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, '..', 'verify-composition.mjs');
const FIX = (name) => path.join(here, 'fixtures', name);

function run(fixture, breakpoints) {
  const args = [SCRIPT, FIX(fixture)];
  if (breakpoints) args.push('--breakpoints', breakpoints);
  const res = spawnSync('node', args, { encoding: 'utf8' });
  let violations = [];
  try {
    violations = JSON.parse(res.stdout || '[]');
  } catch {
    violations = [];
  }
  return { code: res.status, violations, stderr: res.stderr };
}

// Preflight synchronously (spawnSync) so `skip` is known at registration time.
// If Chrome can't render, the script degrades with an `environment` finding and
// exit 2 — in that case we skip the render-dependent tests.
const preflight = run('clean.html', '1280');
const skip =
  preflight.code === 2 && preflight.violations.some((v) => v.rule === 'environment')
    ? 'Chrome/Chromium not available — skipping headless render tests'
    : false;

test('rule 2: unequal card heights in a grid row are reported with numbers', { skip }, () => {
  const { violations } = run('unequal-cards.html', '1280');
  const heightViolations = violations.filter((v) => v.rule === 'unequal-sibling-heights');
  assert.ok(heightViolations.length >= 1, 'expected at least one unequal-sibling-heights violation');
  const v = heightViolations[0];
  assert.equal(v.severity, 'warn');
  assert.ok(v.measured.diffPx > 8, `diffPx should exceed 8px, got ${v.measured.diffPx}`);
  assert.ok(v.measured.diffPct > 4, `diffPct should exceed 4%, got ${v.measured.diffPct}`);
  assert.ok(v.measured.rowMaxHeightPx > v.measured.heightPx);
});

test('rule 1: a nowrap line that bursts the container reports overflow + culprit', { skip }, () => {
  const { code, violations } = run('overflow-nowrap.html', '390');
  const overflow = violations.filter((v) => v.rule === 'horizontal-overflow');
  assert.ok(overflow.length >= 1, 'expected a horizontal-overflow violation');
  const v = overflow[0];
  assert.equal(v.severity, 'error');
  assert.ok(v.measured.overflowPx > 1, 'overflow should be measured in px');
  assert.ok(Array.isArray(v.measured.offenders) && v.measured.offenders.length >= 1, 'expected offender list');
  const hitRunaway = v.measured.offenders.some((o) => /runaway/.test(o.selector));
  assert.ok(
    hitRunaway,
    `offender selector should point at the nowrap element, got ${JSON.stringify(v.measured.offenders.map((o) => o.selector))}`
  );
  assert.equal(code, 1, 'an error-severity violation must exit non-zero');
});

test('rule 4: muted gray text on a tinted panel is flagged as low contrast', { skip }, () => {
  const { code, violations } = run('low-contrast.html', '1280');
  const contrast = violations.filter((v) => v.rule === 'contrast');
  assert.ok(contrast.length >= 1, 'expected a contrast violation');
  const v = contrast.find((c) => /muted/.test(c.selector)) || contrast[0];
  assert.equal(v.severity, 'error');
  assert.ok(v.measured.ratio < 4.5, `ratio should be below 4.5, got ${v.measured.ratio}`);
  assert.equal(v.expected.minRatio, 4.5);
  assert.equal(code, 1);
});

test('clean page: no violations and exit 0', { skip }, () => {
  const { code, violations } = run('clean.html', '390,768,1280');
  assert.deepEqual(violations, [], `expected no violations, got ${JSON.stringify(violations, null, 2)}`);
  assert.equal(code, 0);
});

test('reveal-gated section is forced visible and still measured (contrast caught)', { skip }, () => {
  const { violations } = run('reveal-gated.html', '1280');
  const gated = violations.filter((v) => v.rule === 'contrast' && /gated/.test(v.selector));
  assert.ok(
    gated.length >= 1,
    `reveal-gated text should be revealed and measured; got ${JSON.stringify(violations.map((v) => `${v.rule}:${v.selector}`))}`
  );
});
