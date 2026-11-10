import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { SignatureMark } from "@ra/contracts";
import { normalizeLogo } from "../websites/LogoSettings";

/** Show the selected artwork in both the signing form and each agreement page's reserved signature area. */
export function SignatureAppearance({
  mark,
  name,
}: {
  mark: SignatureMark;
  name: string;
}) {
  const text = useRef<SVGTextElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    let active = true;
    void Promise.resolve(document.fonts?.ready).then(() => {
      if (active)
        setScale(
          Math.min(
            1,
            176 / Math.max(1, text.current?.getComputedTextLength?.() ?? 176),
          ),
        );
    });
    return () => {
      active = false;
    };
  }, [name, mark]);
  return (
    <div className="signature-appearance">
      {mark.mode === "typed" ? (
        <svg viewBox="0 0 180 42" role="img" aria-label={name}>
          <text
            ref={text}
            transform={`translate(${178 * (1 - scale)} ${2 * (1 - scale)}) scale(${scale})`}
            x="178"
            y="31"
            textAnchor="end"
            className={`signature-font-${/^[\u0020-\u024f]+$/.test(name) ? mark.font : "formal"}`}
            fontSize={28}
          >
            {name}
          </text>
        </svg>
      ) : (
        <img src={mark.image} alt="Selected signature" />
      )}
      <span>Investor signature</span>
    </div>
  );
}

/** Capture a private signature by upload, touch/mouse drawing or locally bundled typed fonts. */
export function SignatureInput({
  value,
  onChange,
  onBusy,
  name,
  hi,
  disabled,
}: {
  value: SignatureMark | null;
  onChange: (mark: SignatureMark | null) => void;
  onBusy: (busy: boolean) => void;
  name: string;
  hi: boolean;
  disabled: boolean;
}) {
  const [mode, setMode] = useState<SignatureMark["mode"]>("typed");
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const stroke = useRef<{ x: number; y: number; distance: number } | null>(
    null,
  );
  /** Map pointer coordinates to the fixed-resolution drawing surface at any responsive size. */
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * 512) / rect.width,
      y: ((event.clientY - rect.top) * 160) / rect.height,
    };
  }
  /** Begin a fresh stroke and invalidate the previous mark until the current drawing is complete. */
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const context = canvas.current!.getContext("2d");
    if (!context) {
      setError(
        hi
          ? "चित्र बनाना उपलब्ध नहीं है। दूसरा विकल्प चुनें।"
          : "Drawing is unavailable. Choose another option.",
      );
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    stroke.current = { ...p, distance: 0 };
    context.beginPath();
    context.moveTo(p.x, p.y);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.strokeStyle = "#172a23";
    onChange(null);
    setError("");
  }
  /** Keep strokes in canvas pixels, preserving touch input without scrolling the drawing pad. */
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!stroke.current) return;
    const p = point(event),
      previous = stroke.current;
    const context = canvas.current!.getContext("2d")!;
    context.lineTo(p.x, p.y);
    context.stroke();
    stroke.current = {
      ...p,
      distance:
        previous.distance + Math.hypot(p.x - previous.x, p.y - previous.y),
    };
  }
  /** Commit a nonempty drawing only after the pointer has finished; cancellation discards partial marks. */
  function finish(event: PointerEvent<HTMLCanvasElement>) {
    if (!stroke.current) return;
    const distance = stroke.current.distance;
    stroke.current = null;
    if (event.type === "pointercancel" || distance < 4) {
      onChange(null);
      return;
    }
    const image = canvas.current!.toDataURL("image/png");
    if (image.length > 131094) {
      setError(
        hi ? "सरल हस्ताक्षर बनाएं।" : "Please draw a simpler signature.",
      );
      return;
    }
    onChange({ mode: "draw", image });
  }
  /** Normalize local image pixels before retaining them in this checkout's unsent signature selection. */
  async function upload(file: File) {
    onBusy(true);
    setError("");
    onChange(null);
    try {
      onChange({ mode: "upload", image: await normalizeLogo(file) });
    } catch {
      setError(
        hi
          ? "PNG, JPEG या WebP (2 MB तक) चुनें।"
          : "Choose a PNG, JPEG or WebP signature up to 2 MB, at most 4096 × 4096 pixels.",
      );
    } finally {
      onBusy(false);
    }
  }
  return (
    <fieldset className="signature-input" disabled={disabled}>
      <legend>{hi ? "आपके हस्ताक्षर" : "Your signature"}</legend>
      <p>
        {hi
          ? "हस्ताक्षर हर पृष्ठ के नीचे दाईं ओर दिखेंगे। सभी विकल्पों के लिए ईमेल पुष्टि आवश्यक है।"
          : "Your signature will appear at the bottom right of every page. Email confirmation is required for every option."}
      </p>
      <label>
        {hi ? "हस्ताक्षर का तरीका" : "Signature method"}
        <select
          aria-label={hi ? "हस्ताक्षर का तरीका" : "Signature method"}
          value={mode}
          onChange={(event) => {
            const next = event.target.value as SignatureMark["mode"];
            setMode(next);
            setError("");
            stroke.current = null;
            onChange(
              next === "typed" ? { mode: "typed", font: "allura" } : null,
            );
          }}
        >
          <option value="typed">
            {hi ? "नाम लिखें और फ़ॉन्ट चुनें" : "Type name and choose font"}
          </option>
          <option value="draw">
            {hi ? "हस्ताक्षर बनाएं" : "Draw signature"}
          </option>
          <option value="upload">
            {hi ? "हस्ताक्षर अपलोड करें" : "Upload signature"}
          </option>
        </select>
      </label>
      {mode === "typed" && (
        <label>
          {hi ? "हस्ताक्षर फ़ॉन्ट" : "Signature font"}
          <select
            aria-label={hi ? "हस्ताक्षर फ़ॉन्ट" : "Signature font"}
            value={value?.mode === "typed" ? value.font : "allura"}
            onChange={(event) =>
              onChange({
                mode: "typed",
                font: event.target.value as "allura" | "caveat" | "formal",
              })
            }
          >
            <option value="allura">Allura</option>
            <option value="caveat">Caveat</option>
            <option value="formal">Noto Sans (हिंदी / formal)</option>
          </select>
        </label>
      )}
      {mode === "upload" && (
        <label>
          {hi ? "हस्ताक्षर की छवि" : "Signature image"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
        </label>
      )}
      {mode === "draw" && (
        <>
          <canvas
            className="signature-pad"
            ref={canvas}
            width={512}
            height={160}
            aria-label={
              hi ? "यहाँ हस्ताक्षर बनाएं" : "Draw your signature here"
            }
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={finish}
          />
          <button
            type="button"
            onClick={() => {
              canvas.current!.getContext("2d")?.clearRect(0, 0, 512, 160);
              stroke.current = null;
              onChange(null);
            }}
          >
            {hi ? "साफ करें" : "Clear drawing"}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {value && name && (
        <div
          className="signature-selection"
          aria-label={hi ? "चुने गए हस्ताक्षर" : "Selected signature preview"}
        >
          <SignatureAppearance mark={value} name={name} />
        </div>
      )}
    </fieldset>
  );
}
