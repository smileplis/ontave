import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

export default defineConfig({
  resolve: {dedupe: ['react', 'react-dom'], alias: [
    // Cached website dependencies and the framework must share the root's pinned React runtime.
    {find: 'react', replacement: fileURLToPath(new URL('../node_modules/react', import.meta.url))},
    {find: 'react-dom', replacement: fileURLToPath(new URL('../node_modules/react-dom', import.meta.url))},
    {find: 'ontave/application/react', replacement: fileURLToPath(new URL('../dist/application-react.js', import.meta.url))},
    {find: 'ontave/application/export', replacement: fileURLToPath(new URL('../dist/application-export.js', import.meta.url))},
    {find: 'ontave/application/http', replacement: fileURLToPath(new URL('../dist/application-http.js', import.meta.url))},
    {find: 'ontave/application/model', replacement: fileURLToPath(new URL('../dist/application-model.js', import.meta.url))},
    {find: 'ontave/application/styles.css', replacement: fileURLToPath(new URL('../src/application.css', import.meta.url))},
    {find: 'ontave/application', replacement: fileURLToPath(new URL('../dist/application.js', import.meta.url))},
    {find: 'ontave/styles.css', replacement: fileURLToPath(new URL('../src/interactive.css', import.meta.url))},
    {find: 'ontave/react', replacement: fileURLToPath(new URL('../dist/react.js', import.meta.url))},
    {find: 'ontave', replacement: fileURLToPath(new URL('../dist/index.js', import.meta.url))},
  ]},
  server: {fs: {allow: [fileURLToPath(new URL('..', import.meta.url))]}},
  build: {rollupOptions: {input: {
    applications: fileURLToPath(new URL('./applications/index.html', import.meta.url)),
    landing: fileURLToPath(new URL('./index.html', import.meta.url)),
    playground: fileURLToPath(new URL('./playground/index.html', import.meta.url)),
  }}},
});
