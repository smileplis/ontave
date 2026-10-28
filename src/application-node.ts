import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, rename, unlink, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {z} from 'zod';
import {ApplicationEffect, ApplicationError, ApplicationReceipt, ApplicationRecord, createSnapshotApplicationStore, type ApplicationStore} from './application.js';

const Snapshot = z.strictObject({
  revision: z.number().int().min(1).nullable(), fingerprint: z.string().nullable(),
  records: z.record(z.string(), z.array(ApplicationRecord)),
  requests: z.record(z.string(), z.strictObject({fingerprint: z.string(), receipt: ApplicationReceipt})),
  effects: z.array(ApplicationEffect),
});
const stores = new Map<string, ApplicationStore>();
/** Local, single-process reference adapter. Install a transactional database adapter for multi-process hosting. */
export function createFileApplicationStore(directory: string): ApplicationStore {
  const root = resolve(directory);
  const installed = stores.get(root);
  if (installed) return installed;
  const path = (scope: {applicationId: string; workspaceId: string}) => join(root, `${createHash('sha256').update(JSON.stringify([scope.applicationId, scope.workspaceId])).digest('hex')}.json`);
  const store = createSnapshotApplicationStore({
    async load(scope) {
      try {
        const file = path(scope);
        if ((await stat(file)).size > 32 * 1024 * 1024) throw new Error('The local store exceeds its 32 MiB reference-adapter limit.');
        return Snapshot.parse(JSON.parse(await readFile(file, 'utf8')));
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
        throw new ApplicationError('STORAGE', 'The application store could not be read. It was not reset.');
      }
    },
    async save(scope, snapshot) {
      const data = JSON.stringify(Snapshot.parse(snapshot));
      if (Buffer.byteLength(data) > 32 * 1024 * 1024) throw new ApplicationError('STORAGE', 'The local reference store is full. Install a database adapter.');
      await mkdir(root, {recursive: true, mode: 0o700});
      const target = path(scope), temporary = `${target}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, target);
      } catch {
        await unlink(temporary).catch(() => {});
        throw new ApplicationError('STORAGE', 'The application store could not be committed. Retry the identical request.');
      }
    },
  });
  stores.set(root, store);
  return store;
}

export class ApplicationExportConflict extends Error {
  constructor(public readonly paths: readonly string[]) { super(`Export would overwrite edited or unowned files: ${paths.join(', ')}.`); this.name = 'ApplicationExportConflict'; }
}
/** Preserve user-owned files and refuse edited generated files; individual file replacements are atomic. */
export async function writeApplicationExport(directory: string, bundle: import('./application-export.js').ApplicationExport): Promise<void> {
  const {lstat, writeFile} = await import('node:fs/promises');
  const {dirname, sep} = await import('node:path');
  const root = resolve(directory);
  function safe(path: string) {
    if (!/^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(path) || path.split('/').some(part => ['.', '..', '.git', 'node_modules', '.ontave'].includes(part))) throw new Error('Invalid exported source path.');
    const target = resolve(root, path);
    if (!target.startsWith(root + sep)) throw new Error('Export path escaped the target directory.');
    return target;
  }
  async function noSymlinks(target: string) {
    let current = root;
    for (const part of ['', ...target.slice(root.length + 1).split(sep)]) {
      if (part) current = join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Export paths must not contain symbolic links.'); }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
    }
  }
  const Manifest = z.strictObject({version: z.literal(1), applicationId: z.string(), files: z.record(z.string(), z.strictObject({sha256: z.string().regex(/^[a-f0-9]{64}$/), ownership: z.enum(['generated', 'user'])}))});
  const manifestPath = join(root, '.ontave', 'export.json');
  await noSymlinks(manifestPath);
  let previous: z.infer<typeof Manifest> | null = null;
  try { previous = Manifest.parse(JSON.parse(await readFile(manifestPath, 'utf8'))); }
  catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw new Error('The previous export manifest is invalid. No files were changed.'); }
  if (previous && previous.applicationId !== bundle.definition.id) throw new Error('The target directory belongs to another application.');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const files = new Map<string, import('./application-export.js').ApplicationExportFile>();
  for (const file of bundle.files) { safe(file.path); if (files.has(file.path)) throw new Error('Duplicate exported source path.'); files.set(file.path, file); }
  const conflicts: string[] = [], write: typeof bundle.files = [], remove: string[] = [];
  const next: z.infer<typeof Manifest> = {version: 1, applicationId: bundle.definition.id, files: {}};
  for (const path of new Set([...Object.keys(previous?.files ?? {}), ...files.keys()])) {
    const target = safe(path); await noSymlinks(target);
    let current: string | null = null;
    try { current = await readFile(target, 'utf8'); }
    catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
    const prior = previous?.files[path], desired = files.get(path);
    if (prior?.ownership === 'user' && current !== null) { next.files[path] = prior; continue; }
    if (current !== null && (!prior || hash(current) !== prior.sha256)) { conflicts.push(path); continue; }
    if (desired) { write.push(desired); next.files[path] = {sha256: hash(desired.content), ownership: desired.ownership}; }
    else if (prior?.ownership === 'generated' && current !== null) remove.push(target);
  }
  if (conflicts.length) throw new ApplicationExportConflict(conflicts);
  for (const file of write) {
    const target = safe(file.path); await mkdir(dirname(target), {recursive: true});
    const temporary = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, file.content, {flag: 'wx'}); await rename(temporary, target); }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
  for (const path of remove) await unlink(path);
  await mkdir(dirname(manifestPath), {recursive: true});
  const temporary = `${manifestPath}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', {flag: 'wx'}); await rename(temporary, manifestPath); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
