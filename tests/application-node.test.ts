import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplicationRuntime} from '../src/application.js';
import {ApplicationExportConflict, createFileApplicationStore, writeApplicationExport} from '../src/application-node.js';
import {applicationExportArchive, exportApplication} from '../src/application-export.js';
import {exampleApplication} from '../examples/application/definition.js';
const directories: string[] = [];
async function temporary() { const directory = await mkdtemp(join(tmpdir(), 'ontave-app-test-')); directories.push(directory); return directory; }
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true}); });
const context = {actorId: 'alice', workspaceId: 'workspace'};

describe('persistent reference adapter', () => {
  it('persists complete receipts and effects and serializes multiple instances for one directory', async () => {
    const directory = await temporary(), definition = exampleApplication();
    const first = createApplicationRuntime({definition, store: createFileApplicationStore(directory), authorize: () => true});
    const second = createApplicationRuntime({definition, store: createFileApplicationStore(directory), authorize: () => true});
    const command = {kind: 'create', entity: 'leads', requestId: 'durable', values: {name: 'Ada'}};
    const [a, b] = await Promise.all([first.execute(context, command), second.execute(context, command)]);
    expect(a).toEqual(b); expect(await second.list(context, 'leads')).toHaveLength(1);
    const files = await readdir(directory); expect(files).toHaveLength(1);
    const snapshot = JSON.parse(await readFile(join(directory, files[0]), 'utf8'));
    expect(Object.keys(snapshot.requests)).toHaveLength(1); expect(snapshot.effects).toHaveLength(1);
  });
  it('rejects corrupt storage without clearing or replacing it', async () => {
    const directory = await temporary(), runtime = createApplicationRuntime({definition: exampleApplication(), store: createFileApplicationStore(directory), authorize: () => true});
    await runtime.execute(context, {kind: 'create', entity: 'leads', requestId: 'first', values: {name: 'Ada'}});
    const [file] = await readdir(directory); await writeFile(join(directory, file), '{broken');
    await expect(runtime.list(context, 'leads')).rejects.toMatchObject({code: 'STORAGE'});
    expect(await readFile(join(directory, file), 'utf8')).toBe('{broken');
  });
});

describe('editable source export', () => {
  const bundle = () => exportApplication(exampleApplication(), {frameworkDependency: 'file:./vendor/ontave.tgz'});
  it('emits actual pages, a persistent backend and independently editable extension files', () => {
    const result = bundle();
    const page = result.files.find(file => file.path === 'src/pages/page_1.tsx')!.content;
    expect(page).toContain('Potential value'); expect(page).toContain('ApplicationFieldInput'); expect(page).toContain('collection.save');
    expect(result.files.find(file => file.path === 'server.mjs')?.content).toContain('createFileApplicationStore');
    expect(result.files.find(file => file.path === 'src/extensions.tsx')?.ownership).toBe('user');
    expect(JSON.parse(result.files.find(file => file.path === 'application.json')!.content)).toEqual(exampleApplication());
    expect(() => exportApplication({...exampleApplication(), pages: [{...exampleApplication().pages[0], kind: 'uninstalled'}]}, {frameworkDependency: 'file:./ontave.tgz'})).toThrow('source exporter');
  });
  it('preserves extensions and refuses to overwrite edited generated files', async () => {
    const directory = await temporary(), original = bundle();
    await writeApplicationExport(directory, original);
    const extension = join(directory, 'src/extensions.tsx'); await writeFile(extension, '// developer extension\n');
    await writeApplicationExport(directory, original);
    expect(await readFile(extension, 'utf8')).toBe('// developer extension\n');
    const page = join(directory, 'src/pages/page_1.tsx'); await writeFile(page, '// edited page\n');
    await expect(writeApplicationExport(directory, original)).rejects.toBeInstanceOf(ApplicationExportConflict);
    expect(await readFile(page, 'utf8')).toBe('// edited page\n');
    expect(await readFile(extension, 'utf8')).toBe('// developer extension\n');
  });
  it('rejects path traversal, duplicate paths and symlinks before changing files', async () => {
    const directory = await temporary(), outside = await temporary(), original = bundle();
    await expect(writeApplicationExport(directory, {...original, files: [{path: '../outside', content: 'bad', ownership: 'generated'}]})).rejects.toThrow('Invalid exported source path');
    await expect(writeApplicationExport(directory, {...original, files: [original.files[0], original.files[0]]})).rejects.toThrow('Duplicate');
    await symlink(outside, join(directory, 'src'));
    await expect(writeApplicationExport(directory, original)).rejects.toThrow('symbolic links');
    expect(await readdir(outside)).toEqual([]);
  });
  it('escapes model text in generated TSX/HTML rather than interpolating executable markup', () => {
    const definition = exampleApplication(); definition.name = '<script>alert(1)</script>'; definition.entities[0].fields[0].label = '<img src=x onerror=alert(1)>';
    const result = exportApplication(definition, {frameworkDependency: 'file:./ontave.tgz'});
    expect(result.files.find(file => file.path === 'index.html')!.content).toContain('&lt;script&gt;');
    expect(result.files.find(file => file.path === 'src/pages/page_1.tsx')!.content).toContain('{"<img src=x onerror=alert(1)>"}');
  });
  it('produces a deterministic ZIP with complete file entries', () => {
    const result = bundle(), a = applicationExportArchive(result), b = applicationExportArchive(result);
    expect(a).toEqual(b); expect(new DataView(a.buffer).getUint32(0, true)).toBe(0x04034b50);
    const text = new TextDecoder().decode(a); expect(text).toContain('server.mjs'); expect(text).toContain('src/pages/page_1.tsx');
  });
});
