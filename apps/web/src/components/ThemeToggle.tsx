import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, Desktop, Moon, Sun } from "@phosphor-icons/react";

type Theme = "system" | "light" | "dark";

const KEY = "giroledger-theme";

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Desktop },
];

/**
 * Theme picker, as a dropdown.
 *
 * A three-up segmented control put a permanent 90px widget in the header for a
 * setting most people touch once. This is one icon button that opens a menu,
 * which is the right weight for how often it is used.
 *
 * "System" stays a real option rather than an implicit default: someone who
 * has never touched the control and someone who deliberately chose to follow
 * their OS are different people, and only one should be surprised at sunset.
 * Choosing it removes the attribute entirely, handing control back to the
 * `prefers-color-scheme` block in styles.css.
 *
 * The trigger icon shows the CHOICE, not the resolved theme. Showing a moon
 * while set to "System" would imply dark had been picked deliberately.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {
      // Private mode, or storage disabled. Fall back to following the OS.
    }
  }, []);

  // Close on outside click or Escape. A dropdown that only closes by
  // re-clicking the trigger feels broken.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = useCallback((next: Theme) => {
    setTheme(next);
    setOpen(false);
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // The theme still applies for this session; it just will not persist.
    }
  }, []);

  const current = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2]!;
  const TriggerIcon = mounted ? current.Icon : Desktop;

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Theme: ${mounted ? current.label : "System"}`}
        title="Theme"
        className="tap grid h-8 w-8 place-items-center rounded-[var(--radius)]"
        style={{ color: "var(--text-muted)" }}
      >
        <TriggerIcon size={16} />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="fade-in absolute right-0 z-30 mt-1.5 w-36 overflow-hidden rounded-[var(--radius)] border p-1"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface)",
            boxShadow: "var(--shadow)",
          }}
        >
          {OPTIONS.map(({ value, label, Icon }) => {
            const active = mounted && theme === value;
            return (
              <button
                key={value}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => apply(value)}
                className="tap flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-[13px]"
                style={{ color: active ? "var(--text)" : "var(--text-muted)" }}
              >
                <Icon size={15} />
                <span className="flex-1">{label}</span>
                {active && <Check size={13} weight="bold" style={{ color: "var(--accent-text)" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
