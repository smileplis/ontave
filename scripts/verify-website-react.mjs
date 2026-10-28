import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'ontave-website-react-'));
try {
  await cp(join(root, 'website'), join(temporary, 'website'), {
    recursive: true,
    filter: path => !['node_modules', 'dist', '.vercel'].some(name => path === join(root, 'website', name) || path.startsWith(join(root, 'website', name) + '/')),
  });
  await cp(join(root, 'dist'), join(temporary, 'dist'), {recursive: true});
  await cp(join(root, 'src'), join(temporary, 'src'), {recursive: true});
  await cp(join(root, 'examples/application'), join(temporary, 'examples/application'), {recursive: true});
  await cp(join(root, 'examples/react'), join(temporary, 'examples/react'), {recursive: true, filter: path => !path.includes('/dist') && !path.includes('/node_modules')});
  await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  const nested = join(temporary, 'website/node_modules');
  await mkdir(nested);
  // Reproduce a host that restores a separate website dependency cache.
  for (const name of ['react', 'react-dom', 'scheduler']) await cp(join(root, 'node_modules', name), join(nested, name), {recursive: true});
  let checked = false;
  await build({root: join(temporary, 'website'), logLevel: 'silent', plugins: [{
    name: 'verify-one-react-runtime',
    generateBundle() {
      const modules = [...this.getModuleIds()].map(id => id.replaceAll('\\', '/'));
      const roots = new Set(modules.flatMap(id => id.match(/^(.*\/node_modules\/react)\/(?:index\.js|cjs\/react\.[^/]+\.js)$/)?.[1] ?? []));
      assert.equal(roots.size, 1, 'The website bundled multiple React runtimes. Hooks would fail.');
      assert(!modules.some(id => id.startsWith(nested + '/react/')), 'The website used the restored nested cache instead of the pinned root React.');
      checked = true;
    },
  }]});
  assert(checked, 'The production bundle was not inspected.');
  console.log('Verified website React singleton with a separate restored dependency cache.');
} finally { await rm(temporary, {recursive: true, force: true}); }
