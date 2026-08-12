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

  // `vite preview` rejects any Host header it does not recognise, as a defence
  // against DNS rebinding. Behind a reverse proxy the incoming Host is the
  // public domain, not localhost, so every request comes back "Blocked
  // request. This host is not allowed."
  //
  // ALLOWED_HOSTS is a comma-separated list read at RUN time, so a new domain
  // needs a restart rather than a rebuild. It has to stay separate from the
  // VITE_ variables, which are compiled into the browser bundle at build time
  // and are useless to a server that starts later.
  preview: {
    allowedHosts: [
      ...(process.env['ALLOWED_HOSTS']?.split(',').map((h) => h.trim()).filter(Boolean) ?? []),
      'localhost',
      '127.0.0.1',
    ],
  },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
