// 화면 시험용 묶음 만들기 — 실제 화면 코드(src)에 가짜 DB(mocksb2.js)를 끼워 /tmp/jsportal-test/site/out_app.js 로
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
await build({
  entryPoints: [path.join(here, 'entry_app.jsx')], bundle: true, platform: 'browser', format: 'esm', outfile: '/tmp/jsportal-test/site/out_app.js',
  loader: { '.js': 'jsx', '.jsx': 'jsx' }, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://x"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"k"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"test"', 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
  nodePaths: [path.join(root, 'node_modules')],
  plugins: [{ name: 'sb', setup(b) { b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: path.join(here, 'mocksb2.js') })) } }],
})
console.log('묶음 완료')
