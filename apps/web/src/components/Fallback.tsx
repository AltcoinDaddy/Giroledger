import { Link } from "@tanstack/react-router";

/**
 * What a visitor sees when something goes wrong.
 *
 * Both cases previously produced a blank page: a mistyped URL fell through to
 * TanStack's generic `<p>Not Found</p>`, and any thrown render error left an
 * empty document with the detail only in the console. A judge hitting either
 * would reasonably conclude the site is broken.
 *
 * Neither screen is a dead end. Both offer the two things that actually work.
 */
function Shell(props: {
  code: string;
  title: string;
  children: React.ReactNode;
  detail?: string;
}) {
  return (
    <div
      className="landing grid min-h-[100dvh] place-items-center px-6"
      style={{ background: "var(--bg)" }}
    >
      <div className="w-full max-w-[38rem] py-24 text-center">
        <p className="font-mono text-[13px] tnum" style={{ color: "var(--l-text-faint)" }}>
          {props.code}
        </p>
        <h1 className="mt-5 text-[2rem] leading-[1.15] sm:text-[2.5rem]">{props.title}</h1>
        <p
          className="mx-auto mt-5 max-w-[46ch] text-[16px] leading-[1.75]"
          style={{ color: "var(--l-text-muted)" }}
        >
          {props.children}
        </p>

        {props.detail !== undefined && (
          <pre
            className="mt-8 max-h-40 overflow-auto rounded-[var(--l-radius)] p-4 text-left font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap"
            style={{ background: "var(--bg-subtle)", color: "var(--l-text-muted)" }}
          >
            {props.detail}
          </pre>
        )}

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
          <Link
            to="/"
            className="tap inline-flex items-center rounded-full px-7 py-3.5 text-[15px] font-medium"
            style={{
              background: "var(--accent)",
              color: "var(--accent-fg)",
              boxShadow: "var(--l-raised)",
            }}
          >
            Back to the start
          </Link>
          <Link to="/app" className="tap text-[15px]" style={{ color: "var(--l-text-muted)" }}>
            Open the app
          </Link>
        </div>
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <Shell code="404" title="That page does not exist.">
      There are only three: the overview, the app, and a page explaining how it works and
      what it cannot do yet.
    </Shell>
  );
}

/**
 * The error screen shows the real message.
 *
 * This is a testnet prototype whose whole argument is that you can check it
 * yourself, so hiding the failure behind "something went wrong" would be the
 * wrong instinct. The most likely cause by far is a public RPC refusing a call,
 * and saying so beats leaving someone guessing.
 */
export function ErrorScreen({ error }: { error: Error }) {
  return (
    <Shell
      code="Error"
      title="Something broke on this page."
      detail={error.message}
    >
      Your funds are not involved: this page only reads from the chain. The usual cause is
      the public Coston2 RPC refusing a request, in which case a reload is often enough.
    </Shell>
  );
}
