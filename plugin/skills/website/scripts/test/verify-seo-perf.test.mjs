/**
 * Acceptance tests for verify-seo-perf.mjs.
 *
 * Zero-dependency: node:test + node:assert, driving the real script. Runs with
 * --no-chrome so the suite is deterministic and needs no browser (the runtime
 * perf pass is exercised separately/optionally).
 *
 * Run:  node --test plugin/skills/website/scripts/test/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, '..', 'verify-seo-perf.mjs');
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

test('clean page: no blocking (error) findings and exit 0', () => {
  const { code, findings } = run('seo-clean.html');
  const errors = findings.filter((f) => f.severity === 'error');
  assert.deepEqual(
    errors,
    [],
    `expected no error-severity findings, got ${JSON.stringify(errors, null, 2)}`
  );
  assert.equal(code, 0);
});

test('broken page: missing title/h1/viewport/og:image are blocking errors, exit 1', () => {
  const { code, findings } = run('seo-broken.html');
  assert.ok(has(findings, 'title-missing'), 'should flag missing <title>');
  assert.ok(has(findings, 'h1-missing'), 'should flag missing <h1>');
  assert.ok(has(findings, 'viewport-missing'), 'should flag missing viewport');
  assert.ok(has(findings, 'og-image-missing'), 'should flag missing og:image');
  const errs = findings.filter((f) => f.severity === 'error').map((f) => f.rule);
  assert.ok(errs.includes('title-missing') && errs.includes('viewport-missing'), `errors: ${errs}`);
  assert.equal(code, 1, 'error-severity findings must exit non-zero');
});

test('broken page: invalid JSON-LD is caught as a structured-data error', () => {
  const { findings } = run('seo-broken.html');
  const ld = findings.filter((f) => f.rule === 'structured-data-invalid');
  assert.ok(ld.length >= 1, 'invalid JSON-LD should be reported');
  assert.equal(ld[0].severity, 'error');
});

test('broken page: robots noindex is surfaced as an error', () => {
  const { findings } = run('seo-broken.html');
  const noindex = findings.find((f) => f.rule === 'robots-noindex');
  assert.ok(noindex, 'noindex should be flagged');
  assert.equal(noindex.severity, 'error');
});

test('broken page: render-blocking head script + missing image dims flagged (perf)', () => {
  const { findings } = run('seo-broken.html');
  assert.ok(has(findings, 'render-blocking-script'), 'should flag render-blocking head script');
  assert.ok(has(findings, 'img-no-dimensions'), 'should flag images without width/height');
  assert.ok(has(findings, 'img-alt-missing'), 'should flag images without alt');
});

test('clean page: OpenGraph + structured data complete → none of those findings', () => {
  const { findings } = run('seo-clean.html');
  assert.ok(!has(findings, 'og-image-missing'), 'og:image present');
  assert.ok(!has(findings, 'structured-data-missing'), 'JSON-LD present');
  assert.ok(!has(findings, 'title-missing'));
});

test('asset parity: broken relative asset + empty src are blocking errors, exit 1', () => {
  const { code, findings } = run('seo-assets-broken.html');
  const empty = findings.find((f) => f.rule === 'img-src-empty');
  assert.ok(empty, 'empty <img> src should be flagged');
  assert.equal(empty.severity, 'error');

  const broken = findings.find((f) => f.rule === 'asset-broken-local');
  assert.ok(broken, 'broken relative asset should be flagged');
  assert.equal(broken.severity, 'error');
  // ./missing.png + url(./bg-missing.png) = 2; ./asset-present.svg is excluded.
  assert.equal(broken.measured, '2 missing file(s)', `present asset must not be counted: ${broken.measured}`);

  assert.equal(code, 1, 'asset-parity errors must exit non-zero');
});

test('asset parity: hotlinked remote asset is a warn, not a blocking error', () => {
  const { findings } = run('seo-assets-broken.html');
  const ext = findings.find((f) => f.rule === 'asset-external-host');
  assert.ok(ext, 'remote-hosted asset should be flagged');
  assert.equal(ext.severity, 'warn');
});

test('asset parity: existing relative asset is not flagged as broken', () => {
  const { findings } = run('seo-assets-broken.html');
  const broken = findings.find((f) => f.rule === 'asset-broken-local');
  assert.ok(broken && !broken.note.includes('asset-present.svg'), 'present asset must not appear in the broken list');
});

test('asset parity: root-relative missing asset degrades to warn (web root unknown)', () => {
  const { findings } = run('seo-clean.html');
  const rooted = findings.find((f) => f.rule === 'asset-broken-rooted');
  assert.ok(rooted, 'root-relative missing files should be reported');
  assert.equal(rooted.severity, 'warn');
  assert.ok(!has(findings.filter((f) => f.severity === 'error'), 'asset-broken-rooted'), 'root-relative must never be an error');
});
