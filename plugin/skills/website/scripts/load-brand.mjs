#!/usr/bin/env node
/**
 * load-brand — discover, parse, validate and normalise an OPTIONAL brand file.
 *
 * The brand file is never required. When present it becomes a hard constraint
 * the orchestrator feeds into every phase (data → build → motion → audit) so
 * the produced site stays on-brand instead of inventing a fresh identity.
 *
 * Accepted (first match wins) when no path is given:
 *   ./brand.json  ./brand.yaml  ./brand.yml
 *   ./.brand.json  ./brand/brand.json
 * Or pass an explicit path:  node load-brand.mjs ./config/brand.yaml
 *
 * JSON is the recommended, fully-supported format. YAML support is a small
 * built-in subset (2-level maps + simple string arrays) — enough for this
 * schema, no dependency added. If YAML parsing is ambiguous, use JSON.
 *
 * Output:
 *   stdout — normalised brand JSON  (or {"present": false} when none found)
 *   stderr — a human-readable summary + any validation warnings
 *
 * Exit codes:
 *   0  brand found + parsed  (or none found — that is a valid, common state)
 *   1  a brand file exists but could not be parsed / is invalid
 */

import fs from 'node:fs';
import path from 'node:path';

const CANDIDATES = ['brand.json', 'brand.yaml', 'brand.yml', '.brand.json', 'brand/brand.json', 'brand/brand.yaml'];

const KNOWN_KEYS = ['name', 'colors', 'fonts', 'logo', 'logoDark', 'favicon', 'tone', 'voice', 'radius', 'density', 'doNot', 'references', 'assets', 'url'];
const COLOR_KEYS = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'border', 'success', 'warning', 'danger'];
const FONT_KEYS = ['heading', 'body', 'mono'];

function findBrandFile(explicit) {
  if (explicit) return fs.existsSync(explicit) ? path.resolve(explicit) : null;
  for (const c of CANDIDATES) {
    const p = path.resolve(c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// --- minimal YAML subset parser (2-level maps + "- " string arrays) --------
function parseMiniYaml(text) {
  const root = {};
  let curKey = null;
  let curArr = null;
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, ''); // strip trailing comments
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^\s*/)[0].length;
    const trimmed = line.trim();

    if (indent === 0) {
      curArr = null;
      const m = trimmed.match(/^([\w-]+):\s*(.*)$/);
      if (!m) continue;
      const [, key, val] = m;
      if (val === '') {
        root[key] = {};
        curKey = key;
      } else {
        root[key] = coerce(val);
        curKey = null;
      }
    } else {
      // nested under curKey
      if (curKey == null) continue;
      if (trimmed.startsWith('- ')) {
        if (!Array.isArray(root[curKey])) root[curKey] = [];
        root[curKey].push(coerce(trimmed.slice(2)));
      } else {
        const m = trimmed.match(/^([\w-]+):\s*(.*)$/);
        if (!m) continue;
        if (typeof root[curKey] !== 'object' || Array.isArray(root[curKey])) root[curKey] = {};
        root[curKey][m[1]] = coerce(m[2]);
      }
    }
  }
  return root;
}

function coerce(v) {
  let s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function parseBrand(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) return JSON.parse(text);
  return parseMiniYaml(text);
}

function validate(brand) {
  const warnings = [];
  if (!brand || typeof brand !== 'object') {
    warnings.push('Brand file is empty or not an object.');
    return warnings;
  }
  for (const k of Object.keys(brand)) {
    if (!KNOWN_KEYS.includes(k)) warnings.push(`Unknown top-level key "${k}" (ignored). Known: ${KNOWN_KEYS.join(', ')}`);
  }
  if (!brand.name) warnings.push('No "name" — recommended so the build can reference the brand explicitly.');
  if (brand.colors && typeof brand.colors === 'object') {
    for (const [k, v] of Object.entries(brand.colors)) {
      if (!COLOR_KEYS.includes(k)) warnings.push(`colors.${k} is non-standard (kept, but build may not map it). Standard: ${COLOR_KEYS.join(', ')}`);
      if (typeof v === 'string' && !/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) && !/^(rgb|hsl|oklch|var)\(/i.test(v))
        warnings.push(`colors.${k} = "${v}" is not a recognised CSS color.`);
    }
  } else if (brand.colors) {
    warnings.push('"colors" should be a map, e.g. { "primary": "#0F62FE" }.');
  }
  if (brand.fonts && typeof brand.fonts === 'object') {
    for (const k of Object.keys(brand.fonts)) if (!FONT_KEYS.includes(k)) warnings.push(`fonts.${k} is non-standard. Standard: ${FONT_KEYS.join(', ')}`);
  }
  if (brand.logo && typeof brand.logo === 'string') {
    const isUrl = /^https?:\/\//.test(brand.logo);
    if (!isUrl && !fs.existsSync(path.resolve(path.dirname(brandFilePath || '.'), brand.logo)) && !fs.existsSync(path.resolve(brand.logo)))
      warnings.push(`logo "${brand.logo}" not found on disk (ok if it resolves at build time).`);
  }
  if (brand.doNot && !Array.isArray(brand.doNot)) warnings.push('"doNot" should be a list of strings.');
  return warnings;
}

let brandFilePath = null;

function main() {
  const explicit = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const file = findBrandFile(explicit);
  if (!file) {
    process.stdout.write(JSON.stringify({ present: false }, null, 2) + '\n');
    process.stderr.write('load-brand: no brand file found — proceeding without a brand constraint (this is fine).\n');
    process.exit(0);
  }
  brandFilePath = file;
  let brand;
  try {
    brand = parseBrand(file);
  } catch (e) {
    process.stderr.write(`load-brand: failed to parse ${file}: ${e.message}\n`);
    process.exit(1);
  }
  const warnings = validate(brand);
  const out = { present: true, source: file, brand };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.stderr.write(`load-brand: loaded brand from ${file}\n`);
  if (brand.name) process.stderr.write(`  name: ${brand.name}\n`);
  if (brand.colors) process.stderr.write(`  colors: ${Object.keys(brand.colors).join(', ')}\n`);
  if (brand.fonts) process.stderr.write(`  fonts: ${Object.values(brand.fonts).join(' / ')}\n`);
  for (const w of warnings) process.stderr.write(`  ⚠ ${w}\n`);
  process.exit(0);
}

main();
