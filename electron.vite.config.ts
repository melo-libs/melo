import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { visualizer } from 'rollup-plugin-visualizer'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      minify: true,
      sourcemap: false,
      rollupOptions: {
        treeshake: {
          moduleSideEffects: false,
          propertyReadSideEffects: false,
          tryCatchDeoptimization: false,
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      minify: true,
      sourcemap: false,
      rollupOptions: {
        treeshake: {
          moduleSideEffects: false,
          propertyReadSideEffects: false,
          tryCatchDeoptimization: false,
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
    plugins: [
      react(),
      svgr(),
      // pdf.js runtime assets, fetched as individual files: CMaps (CJK
      // encodings) and fallback fonts for PDFs without embedded fonts.
      viteStaticCopy({
        targets: [
          // Absolute paths — the renderer's vite root is src/renderer.
          { src: resolve('node_modules/pdfjs-dist/cmaps') + '/*', dest: 'pdfjs/cmaps' },
          {
            src: resolve('node_modules/pdfjs-dist/standard_fonts') + '/*',
            dest: 'pdfjs/standard_fonts',
          },
        ],
      }),
      visualizer({
        filename: 'stats.html',
        open: true,
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      }),
    ],
    build: {
      rollupOptions: {
        treeshake: {
          moduleSideEffects: 'no-external',
          propertyReadSideEffects: false,
          tryCatchDeoptimization: false,
          unknownGlobalSideEffects: false,
        },
      },
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
          pure_funcs: [
            'console.log',
            'console.info',
            'console.debug',
            'console.time',
            'console.timeEnd',
          ],
          pure_getters: true,
          keep_infinity: true,
          passes: 2,
          module: true,
          unsafe_math: true,
        },
        mangle: {
          toplevel: true,
          safari10: true,
        },
        format: {
          comments: false,
        },
      },
      sourcemap: false,
      chunkSizeWarningLimit: 1000,
      target: 'esnext',
      modulePreload: {
        polyfill: false,
      },
      reportCompressedSize: true,
      cssCodeSplit: true,
      cssMinify: true,
      assetsInlineLimit: 4096,
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        '@tiptap/core',
        '@tiptap/pm/state',
        '@tiptap/pm/view',
        '@tiptap/starter-kit',
      ],
      exclude: ['electron'],
      esbuildOptions: {
        target: 'esnext',
        supported: {
          'top-level-await': true,
        },
        treeShaking: true,
        minify: true,
      },
    },
  },
})
