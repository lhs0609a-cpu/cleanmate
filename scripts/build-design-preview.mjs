import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';

// Keep the local review artifact as the source; publish executable JS separately for CSP.
const source = new URL('../output/quality-redesign/', import.meta.url);
const destination = new URL('../web/public/design/', import.meta.url);
await mkdir(destination, { recursive: true });
let html = await readFile(new URL('index.html', source), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/);
if (!script) throw new Error('Design preview script is missing');
await writeFile(new URL('preview.js', destination), script[1]);
html = html.replace(script[0], '<script src="./preview.js" defer></script>')
  .replace('../../web/public/fonts/', '/fonts/')
  .replace('<head>', '<head><meta name="robots" content="noindex,nofollow">');
await writeFile(new URL('index.html', destination), html);
await copyFile(new URL('설계안.md', source), new URL('설계안.md', destination));
console.log('Built design preview at /design/');
