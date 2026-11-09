import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve('.output/chrome-mv3');
const destination = resolve('dist/chrome-mv3');

await mkdir(resolve('dist'), { recursive: true });
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
