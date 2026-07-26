// Прод-сборка backend: один самодостаточный CommonJS-бандл.
// Зачем esbuild, а не tsc: в проде нужен рабочий node dist/server.js, а tsc
// давал CJS-файл под "type":"module" (крэш "exports is not defined") и
// оставлял import из @vovplan/shared → src/index.ts (сырой TS, Node не грузит).
// esbuild инлайнит @vovplan/shared и внутренние алиасы (@/*, @shared/*),
// а все node_modules-зависимости оставляет external (грузятся из node_modules).
import esbuild from 'esbuild'
import { writeFileSync } from 'node:fs'

await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/server.js',
  tsconfig: './tsconfig.json', // резолвит алиасы @/* и @shared/* из paths
  logLevel: 'info',
  plugins: [
    {
      name: 'externalize-node-modules',
      setup(build) {
        // Бандлим только локальный код и воркспейс @vovplan/shared,
        // всё остальное (fastify, prisma, sharp, socket.io…) — external.
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === 'entry-point') return
          const p = args.path
          if (p.startsWith('.') || p.startsWith('/')) return // относительные → бандлим
          if (p === '@vovplan/shared' || p.startsWith('@vovplan/shared/')) return
          if (p.startsWith('@/') || p.startsWith('@shared/')) return // внутр. алиасы
          return { path: p, external: true } // node_modules → external
        })
      },
    },
  ],
})

// dist лежит рядом с package.json, где "type":"module" — помечаем бандл как CommonJS.
writeFileSync('dist/package.json', '{"type":"commonjs"}\n')
console.log('✓ backend → dist/server.js (cjs bundle)')
