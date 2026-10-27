// Keep the existing framework hosting root usable without duplicating the demo.
import {cpSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const output = fileURLToPath(new URL('./dist/', import.meta.url));
rmSync(output, {recursive: true, force: true});
cpSync(new URL('../examples/react/dist/', import.meta.url), output, {recursive: true});
