import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'ontave-consumer-'));
function run(command, args, cwd = temporary) {
  return execFileSync(command, args, {cwd, encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe']});
}
function node(source) { return execFileSync(process.execPath, ['--input-type=module'], {cwd: temporary, input: source, encoding: 'utf8', timeout: 15000}); }
function typecheck(source) {
  writeFileSync(join(temporary, 'consumer.ts'), source);
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', join(temporary, 'consumer.ts')]);
}
try {
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary], root));
  assert.equal(packed.name, 'ontave');
  for (const {path} of packed.files) {
    assert.match(path, /^(?:dist\/[\w.-]+\.(?:js|d\.ts)|src\/interactive\.css|docs\/[A-Z_]+\.md|package\.json|README\.md|SECURITY\.md|LICENSE)$/u, `Unexpected packed file: ${path}`);
  }
  assert(packed.files.some(file => file.path === 'dist/adapters.js'));
  assert(packed.files.some(file => file.path === 'dist/react.d.ts'));
  assert.match(readFileSync(join(root, 'dist/react.js'), 'utf8'), /^['"]use client['"]/u);
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({name: 'ontave-package-consumer', private: true, type: 'module'}));
  run('npm', ['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', '--prefer-offline', join(temporary, packed.filename)]);
  const consumer = JSON.parse(readFileSync(join(temporary, 'package-lock.json'), 'utf8'));
  assert(!consumer.packages['node_modules/react'], 'Core consumer unexpectedly installed React.');
  assert(!consumer.packages['node_modules/react-dom'], 'Core consumer unexpectedly installed React DOM.');
  node(`
    import assert from 'node:assert/strict';
    import {createRequire} from 'node:module';
    import {Interaction, validateResponse, encodeInteractiveReply, decodeInteractiveReply} from 'ontave';
    import {openAIInteractionTool, parseOpenAIInteraction, INTERACTION_TOOL_NAME} from 'ontave/adapters';
    const spec = Interaction.parse({version:1,question:'Helpful?',description:null,controls:[{key:'score',label:'Score',kind:'rating',required:true,options:[],min:null,max:null}],submitLabel:'Continue'});
    assert.deepEqual({...validateResponse(spec,{score:4})},{score:4});
    assert.deepEqual(decodeInteractiveReply(encodeInteractiveReply('Choose a score.', spec)).interaction,spec);
    assert.equal(openAIInteractionTool().name,INTERACTION_TOOL_NAME);
    assert.deepEqual(parseOpenAIInteraction({type:'function_call',name:INTERACTION_TOOL_NAME,arguments:JSON.stringify(spec)}),spec);
    assert.throws(() => createRequire(import.meta.url).resolve('react'));
  `);
  typecheck(`import {Interaction, validateResponse, type InteractionValues} from 'ontave';
    import {openAIInteractionTool} from 'ontave/adapters';
    const spec: Interaction = Interaction.parse({});
    const values: InteractionValues = validateResponse(spec, {});
    openAIInteractionTool(['text', 'rating']); void values;`);

  // The DOM suite uses React 19; the packed renderer must also support the oldest peer major.
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', '--save-exact', 'react@18', 'react-dom@18', '@types/react@18', '@types/react-dom@18']);
  node(`
    import assert from 'node:assert/strict';
    import {createElement} from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {InteractionForm} from 'ontave/react';
    const html = renderToStaticMarkup(createElement(InteractionForm,{interaction:{version:99},onSubmit(){throw new Error('Unexpected submit');}}));
    assert(html.includes('Reply in chat'));
  `);
  typecheck(`import {createElement} from 'react';
    import {Interaction} from 'ontave';
    import {InteractionForm, type InteractionFormProps} from 'ontave/react';
    const props: InteractionFormProps = {interaction: Interaction.parse({}), interactionId:'turn-1', onSubmit(values){ void values; }};
    createElement(InteractionForm, props);`);
  console.log(`Verified ${packed.filename}: release boundary, core without React, public ESM and declarations, React 18 renderer.`);
} catch (error) {
  if (error?.stderr) process.stderr.write(error.stderr);
  if (error?.stdout) process.stderr.write(error.stdout);
  throw error;
} finally { rmSync(temporary, {recursive: true, force: true}); }
