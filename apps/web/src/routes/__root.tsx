import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";

import appCss from "../styles.css?url";
import { ErrorScreen, NotFound } from "../components/Fallback";

/**
 * Applied before first paint, so a dark-mode visitor never sees a white flash.
 * Inline and synchronous on purpose: a deferred script runs after the browser
 * has already painted the light theme.
 *
 * Reads the saved choice and otherwise leaves the OS in charge. Setting
 * `data-theme="light"` also opts out of the `prefers-color-scheme` block in
 * styles.css, which is how "force light on a dark machine" works.
 */
const themeScript = `(function(){try{var t=localStorage.getItem("giroledger-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

const TITLE = "GiroLedger · Standing orders for XRP";
const DESCRIPTION =
  "One XRP Ledger payment becomes a recurring on-chain rule. No FLR, no EVM wallet, no bridge. Running on Flare Coston2.";

/**
 * Public URL, needed because Open Graph requires absolute values.
 *
 * Falls back to a placeholder rather than a relative path: a relative og:url
 * silently produces a broken unfurl, whereas an obviously wrong domain is
 * noticed. Set VITE_SITE_URL at deploy time.
 */
const SITE = (import.meta.env["VITE_SITE_URL"] as string | undefined) ?? "https://giroledger.example";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      // Lets the browser paint form controls and scrollbars correctly.
      { name: "color-scheme", content: "light dark" },

      /*
       * Open Graph and Twitter. Without these the link unfurls blank on
       * DoraHacks, Discord and X, which is where every judge will meet it.
       *
       * Deliberately `summary` rather than `summary_large_image`: there is no
       * OG image yet, and claiming a large image that does not exist renders
       * worse than a plain card. Switch to summary_large_image and add
       * og:image once a real 1200x630 asset exists.
       */
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "GiroLedger" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: SITE },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: SITE },
    ],
  }),
  shellComponent: RootDocument,
  // Applies to every route, so a typo'd URL or a thrown render error anywhere
  // lands on a real page rather than a blank one.
  notFoundComponent: NotFound,
  errorComponent: ({ error }) => <ErrorScreen error={error} />,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    /*
     * `suppressHydrationWarning` is required here, not a way of hiding a bug.
     *
     * The theme script above deliberately sets `data-theme` on <html> before
     * React hydrates, which is the entire mechanism that stops a dark-mode
     * visitor seeing a white flash. The server cannot know the visitor's saved
     * preference, so it renders no attribute and the client has one. React
     * sees a real difference and warns.
     *
     * It is scoped to this element, so a genuine mismatch anywhere inside the
     * app still reports normally. Browser extensions also inject nodes and
     * attributes into <html> and <body> before React loads, which is the other
     * half of the warning and is not something an app can control.
     */
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        {/* Dev only. A devtools panel floating over a judge's screen is noise. */}
        {import.meta.env.DEV && (
          <TanStackDevtools
            config={{ position: "bottom-right" }}
            plugins={[{ name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> }]}
          />
        )}
        <Scripts />
      </body>
    </html>
  );
}
