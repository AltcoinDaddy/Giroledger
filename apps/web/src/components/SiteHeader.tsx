import { Link } from "@tanstack/react-router";
import { ThemeToggle } from "./ThemeToggle";

/**
 * One header for every route. Single line at every breakpoint, 64px tall.
 *
 * Only real destinations here. An earlier version carried four in-page anchors
 * (How it works, Proof, Why Flare, Limits) which duplicated the scroll a
 * visitor was already doing and added nothing.
 *
 * The network is no longer named here. It is still stated in the footer of
 * every page and on the app screen itself, which is where it matters: nobody
 * should be able to build a payment without knowing it is testnet.
 */
export function SiteHeader(props: { active?: "home" | "app" | "about" }) {
  return (
    <header
      className="sticky top-0 z-20 border-b backdrop-blur"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--bg) 88%, transparent)",
      }}
    >
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" className="text-[17px] font-semibold tracking-tight whitespace-nowrap">
            GiroLedger
          </Link>
        </div>

        <div className="flex items-center gap-1 sm:gap-3">
          <Link
            to="/about"
            className="tap rounded-[var(--radius)] px-2.5 py-1.5 text-[14px]"
            style={{
              color: props.active === "about" ? "var(--text)" : "var(--text-muted)",
            }}
          >
            About
          </Link>

          {props.active !== "app" && (
            <Link
              to="/app"
              className="tap hidden rounded-full px-4 py-1.5 text-[13.5px] font-semibold sm:block"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              Create a rule
            </Link>
          )}

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
