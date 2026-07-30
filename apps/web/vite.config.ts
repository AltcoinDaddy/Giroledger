import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  // The .env lives at the monorepo root so the operator, keeper and web app
  // read one set of addresses. Without this, Vite looks only in apps/web,
  // finds nothing, and every VITE_ variable is silently undefined. The page
  // then renders "contracts are not deployed" against a live deployment.
  envDir: '../../',
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
