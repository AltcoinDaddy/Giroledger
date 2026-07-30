import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * A QR code, rendered to a data URL.
 *
 * Two deliberate decisions.
 *
 * ENCODES ONLY AN XRPL ADDRESS, never the whole payment. The 0xFE memo is 84
 * hex characters and no XRPL wallet reads memos out of a scanned payload, so a
 * QR carrying the full instruction would scan as nonsense in every wallet a
 * judge might try. A bare address scans correctly everywhere, and the amount
 * and memo sit beside it as copy fields.
 *
 * ALWAYS DARK-ON-WHITE, including in dark mode. Inverted QR codes fail on a
 * meaningful share of scanners, so the code keeps its white quiet zone and
 * gets an explicit white frame rather than inheriting the page surface. A
 * themed QR that does not scan is not a themed QR, it is a broken one.
 */
export function Qr(props: { value: string; size?: number; alt: string }) {
  const size = props.size ?? 148;
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    QRCode.toDataURL(props.value, {
      width: size * 2, // 2x for crisp rendering on retina displays
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1a1a19", light: "#ffffff" },
    })
      .then((url) => {
        if (live) setSrc(url);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [props.value, size]);

  const frame = "rounded-[var(--radius)] border p-2";
  const frameStyle = { borderColor: "var(--border)", background: "#ffffff" };

  if (failed) {
    return (
      <div
        className={`${frame} grid place-items-center text-center font-mono text-[10px]`}
        style={{ ...frameStyle, width: size + 20, height: size + 20, color: "#5c5c58" }}
      >
        QR unavailable. Copy the address instead.
      </div>
    );
  }

  if (!src) {
    return (
      <div
        className={frame}
        style={{ ...frameStyle, width: size + 20, height: size + 20 }}
        aria-hidden="true"
      >
        <div className="h-full w-full rounded-[4px]" style={{ background: "#f4f4f2" }} />
      </div>
    );
  }

  return (
    <div className={frame} style={frameStyle}>
      <img src={src} alt={props.alt} width={size} height={size} className="block" />
    </div>
  );
}
