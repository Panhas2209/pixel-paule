/**
 * Acceptance tests for verify-a11y.mjs.
 *
 * Zero-dependency: node:test + node:assert, driving the real script. Runs with
 * --no-chrome so the suite is deterministic and needs no browser (the runtime
 * accessibility-tree pass is exercised separately/optionally).
 *
 * Run:  node --test plugin/skills/website/scripts/test/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, '..', 'verify-a11y.mjs');
const FIX = (name) => path.join(here, 'fixtures', name);

function run(fixture) {
  const res = spawnSync('node', [SCRIPT, FIX(fixture), '--no-chrome'], { encoding: 'utf8' });
  let findings = [];
  try {
    findings = JSON.parse(res.stdout || '[]');
  } catch {
    findings = [];
  }
  return { code: res.status, findings, stderr: res.stderr };
}

const has = (findings, rule) => findings.some((f) => f.rule === rule);
const sev = (findings, rule) => (findings.find((f) => f.rule === rule) || {}).severity;

test('clean page: zero findings and exit 0', () => {
  const { code, findings } = run('a11y-clean.html');
  assert.deepEqual(findings, [], `expected no findings, got ${JSON.stringify(findings, null, 2)}`);
  assert.equal(code, 0);
});

test('broken page: empty link/button, disabled zoom, image-input alt are blocking errors, exit 1', () => {
  const { code, findings } = run('a11y-broken.html');
  assert.equal(sev(findings, 'link-empty'), 'error', 'empty link must be an error');
  assert.equal(sev(findings, 'button-empty'), 'error', 'empty button must be an error');
  assert.equal(sev(findings, 'viewport-zoom-disabled'), 'error', 'user-scalable=no must be an error');
  assert.equal(sev(findings, 'input-image-no-alt'), 'error', 'image input without alt must be an error');
  assert.equal(code, 1, 'error-severity findings must exit non-zero');
});

test('broken page: empty link count includes the icon-only link', () => {
  const { findings } = run('a11y-broken.html');
  const link = findings.find((f) => f.rule === 'link-empty');
  assert.ok(link, 'link-empty should fire');
  assert.equal(link.measured, '2 empty link(s)', `bare + icon link both counted: ${link.measured}`);
});

test('broken page: structural issues are warns, not blocking errors', () => {
  const { findings } = run('a11y-broken.html');
  for (const rule of ['heading-order-skip', 'heading-empty', 'landmark-main-missing', 'control-unlabeled', 'tabindex-positive', 'iframe-title-missing', 'id-duplicate']) {
    assert.equal(sev(findings, rule), 'warn', `${rule} should be a warn`);
  }
});

test('broken page: invalid ARIA role + misspelled aria-* attribute are flagged', () => {
  const { findings } = run('a11y-broken.html');
  assert.ok(has(findings, 'aria-role-invalid'), 'unknown role should be flagged');
  assert.ok(has(findings, 'aria-attr-invalid'), 'misspelled aria-* should be flagged');
  const role = findings.find((f) => f.rule === 'aria-role-invalid');
  assert.ok(role.measured.includes('buton'), `should name the bad role: ${role.measured}`);
});

test('control-unlabeled is a warn (static heuristic) — never a false-positive error', () => {
  const { findings } = run('a11y-broken.html');
  const errors = findings.filter((f) => f.severity === 'error').map((f) => f.rule);
  assert.ok(!errors.includes('control-unlabeled'), 'unlabeled control must not block the build statically');
});

test('clean page: labeled control, named button, titled iframe, single main → none of those findings', () => {
  const { findings } = run('a11y-clean.html');
  for (const rule of ['control-unlabeled', 'button-empty', 'link-empty', 'iframe-title-missing', 'landmark-main-missing', 'aria-role-invalid', 'aria-attr-invalid']) {
    assert.ok(!has(findings, rule), `${rule} should not fire on the clean fixture`);
  }
});
