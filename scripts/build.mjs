// Copies the TronWeb browser bundle into public/ so the site is fully static
// (works on Vercel or any static host, and with the local server).
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
copyFileSync(join(root, 'node_modules/tronweb/dist/TronWeb.js'), join(root, 'public/tronweb.js'));
console.log('Copied TronWeb bundle to public/tronweb.js');
