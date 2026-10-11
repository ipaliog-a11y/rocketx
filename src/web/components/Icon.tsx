import type { Mission } from "../../sim/mission.ts";
import type { ContractKind } from "../../sim/contracts.ts";
import { COLORS } from "../palette.ts";

/**
 * The game's icons: line drawings on a 24-unit grid, in the colour of the
 * text around them. One drawing per idea, so the same thing always looks
 * the same wherever it appears.
 */
export const ICONS = {
  company: "M4 21V8l8-5 8 5v13M9 21v-6h6v6M3 21h18",
  contract: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7",
  launch: "M12 2c3 3 4 7 4 11l-4 3-4-3c0-4 1-8 4-11zM8 13l-3 4 3 1M16 13l3 4-3 1M10 19l2 3 2-3",
  hangar: "M3 21V10l9-6 9 6v11M7 21v-8h10v8M7 17h10",
  stand: "M12 3c2 3 4 5 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-2-1-4 0-7zM6 21h12M9 17v4M15 17v4",
  tunnel: "M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h9",
  money: "M12 3v18M16.5 7.5C15.6 6.3 14 5.5 12 5.5c-2.5 0-4.3 1.3-4.3 3.1 0 4.4 8.6 2.4 8.6 6.8 0 1.8-1.9 3.1-4.3 3.1-2.1 0-3.8-.9-4.6-2.3",
  day: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  reputation: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z",
  licence: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4",
  engine: "M9 3h6v4h-1v3h2l2.5 10h-13L8 10h2V7H9z",
  part: "M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  rocket: "M12 2c3 3 4 7 4 11l-4 3-4-3c0-4 1-8 4-11zM8 13l-3 4 3 1M16 13l3 4-3 1M10 19l2 3 2-3",
  factory: "M3 21V11l6 4v-4l6 4v-4l6 4v6zM3 21h18",
  crew: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5",
  plan: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2",
  orbit: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM3 12c0-3 4-5.5 9-5.5s9 2.5 9 5.5-4 5.5-9 5.5-9-2.5-9-5.5z",
  check: "M5 12.5l4.5 4.5L19 7",
  caution: "M12 4l9 16H3zM12 10v4M12 17h.01",
  info: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v6M12 7.5h.01",
  play: "M8 5l11 7-11 7z",
  next: "M5 12h14M13 6l6 6-6 6",
  simulate: "M3 19l5-7 4 4 4-7 5 6M3 21h18",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size, className, label }: { name: IconName; size?: "sm"; className?: string; label?: string }) {
  return (
    <svg className={`icon ${size ?? ""} ${className ?? ""}`} viewBox="0 0 24 24" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={ICONS[name]} />
    </svg>
  );
}

export type GlyphKind = "sounding" | "leo" | "polar" | "gto" | "escape" | "constellation" | "station";

/** Which picture a mission gets: straight up, a low orbit, polar, a transfer ellipse, an escape, a swarm or a station. */
export function glyphKind(mission: Mission, kind?: ContractKind): GlyphKind {
  const t = mission.target;
  if (!t) return "sounding";
  if (kind === "cargo" || kind === "crew") return "station";
  if (kind === "constellation" || kind === "megaconstellation") return "constellation";
  if (t.c3 !== undefined || !Number.isFinite(t.apoapsis)) return "escape";
  if (Number.isFinite(t.apoapsis) && t.apoapsis > 5_000_000) return "gto";
  if (t.inclination > 80) return "polar";
  return "leo";
}

/**
 * A mission drawn small: the Earth and the path the payload ends on. The
 * first thing to read on a contract, before the money and the dates.
 */
export function MissionGlyph({ kind, size = 40, label }: { kind: GlyphKind; size?: number; label?: string }) {
  const earth = COLORS.dataDeep;
  const path = { fill: "none", stroke: COLORS.action, strokeWidth: 1.6, strokeDasharray: "3 3" };
  const sat = COLORS.text;
  const body = (() => {
    switch (kind) {
      case "sounding":
        return (
          <>
            <path d="M6 42h36" stroke={COLORS.lineStrong} strokeWidth={1.4} />
            <path d="M12 42 Q24 -4 36 42" {...path} />
            <circle cx={24} cy={19} r={2.4} fill={sat} />
          </>
        );
      case "leo":
        return (
          <>
            <circle cx={24} cy={24} r={10} fill={earth} />
            <circle cx={24} cy={24} r={17} {...path} />
            <circle cx={41} cy={24} r={2.4} fill={sat} />
          </>
        );
      case "polar":
        return (
          <>
            <circle cx={24} cy={24} r={10} fill={earth} />
            <ellipse cx={24} cy={24} rx={5} ry={19} {...path} />
            <circle cx={24} cy={5} r={2.4} fill={sat} />
          </>
        );
      case "gto":
        return (
          <>
            <circle cx={13} cy={24} r={8} fill={earth} />
            <ellipse cx={25} cy={24} rx={21} ry={11} {...path} />
            <circle cx={46} cy={24} r={2.2} fill={sat} />
          </>
        );
      case "escape":
        return (
          <>
            <circle cx={11} cy={33} r={8} fill={earth} />
            <path d="M19 30 C 30 26, 34 16, 44 6" {...path} />
            <circle cx={40} cy={10} r={4} fill="none" stroke={COLORS.muted} strokeWidth={1.4} />
          </>
        );
      case "constellation":
        return (
          <>
            <circle cx={24} cy={24} r={10} fill={earth} />
            <circle cx={24} cy={24} r={17} {...path} />
            {[0, 72, 144, 216, 288].map((a) => (
              <circle key={a} cx={24 + 17 * Math.cos((a * Math.PI) / 180)} cy={24 + 17 * Math.sin((a * Math.PI) / 180)} r={1.9} fill={sat} />
            ))}
          </>
        );
      case "station":
        return (
          <>
            <circle cx={24} cy={24} r={10} fill={earth} />
            <circle cx={24} cy={24} r={17} {...path} />
            <path d="M36 21h10M36 27h10M41 21v6" stroke={COLORS.crew} strokeWidth={2} />
          </>
        );
    }
  })();
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 48 48" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {body}
    </svg>
  );
}
