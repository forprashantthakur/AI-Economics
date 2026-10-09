// Turns the single-file Vite build (apps/web/dist-single/index.html) into page content for
// hosting as a claude.ai artifact: the host supplies the <html>/<head>/<body> skeleton, so we
// keep everything inside <head> except the charset/viewport/icon tags, then the root element.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync(process.argv[2] ?? 'apps/web/dist-single/index.html', 'utf8');
const out = process.argv[3] ?? 'apps/web/dist-artifact/index.html';
const headStart = src.indexOf('<head>') + '<head>'.length;
const headEnd = src.lastIndexOf('</head>');
if (headStart < 6 || headEnd < 0) throw new Error('Unexpected build output: no <head>');
let head = src.slice(headStart, headEnd);
// Only strip the first occurrences, which are the real tags at the top of <head>.
for (const re of [/<meta charset="[^"]*"\s*\/?>/, /<meta name="viewport"[^>]*>/, /<link rel="icon"[^>]*>/]) head = head.replace(re, '');
const titleIdx = head.indexOf('<title>');
// The artifact host rejects raw U+FFFD characters. In the bundle they only occur inside JS string
// and template literals, where the \uFFFD escape produces the identical runtime value.
const body = head.slice(titleIdx).trim().replace(/\uFFFD/g, '\\uFFFD');
const page = `${body}\n<div id="root"></div>\n`;
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(out, page);
console.log(`${out}: ${(page.length / 1e6).toFixed(2)} MB`);
