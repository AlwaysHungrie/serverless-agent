"use client";

import { useEffect, useRef } from "react";
import type { McpAuth } from "@/lib/agent";

/**
 * A provider whose MCP server is known: the values its server expects, so connecting
 * one is a click rather than a URL to go and find.
 */
export type McpPreset = {
  id: string;
  name: string;
  url: string;
  auth: McpAuth;
  /** The provider's mark, drawn at 24×24. */
  logo: React.ReactNode;
};

const NotionMark = (
  <svg
    viewBox="0 0 24 24"
    width="26"
    height="26"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.98-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" />
  </svg>
);

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "notion",
    name: "Notion",
    url: "https://mcp.notion.com/mcp",
    auth: "oauth",
    logo: NotionMark,
  },
];

/** How fast the strip drifts, in pixels per second. */
const SPEED = 4;
/** Past this much movement a pointer was dragging the strip, not picking a tile. */
const DRAG_SLOP = 4;

/**
 * The providers, drifting past on a loop.
 *
 * The strip is rendered twice and the offset wraps at half its width, which is what
 * makes the loop seamless. The position is written straight to the node inside the
 * animation frame rather than held in state: it changes sixty times a second, and
 * nothing else in the tree needs to know about it.
 */
export function McpPresetStrip({
  onPick,
  only = [],
}: {
  onPick: (preset: McpPreset) => void;
  /** Preset ids to show. Empty shows every preset. */
  only?: string[];
}) {
  const track = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  // Hovering and dragging both hold the strip still, so a tile can be aimed at.
  const held = useRef(false);
  const drag = useRef<{ x: number } | null>(null);
  /**
   * Whether the pointer has been captured. Capture is taken only once a gesture is
   * a drag: it retargets the pointer-up to this container, and the browser picks the
   * click's target from where the down and the up landed — so capturing on every
   * pointer-down would move every click off the tile and onto the strip.
   */
  const captured = useRef(false);
  // How far the current gesture has travelled. Read by the click that follows the
  // pointer-up, which is the only way to tell a pick from the end of a drag.
  const moved = useRef(0);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();

    const step = (now: number) => {
      const elapsed = now - previous;
      previous = now;
      const node = track.current;
      if (node) {
        if (!held.current) offset.current -= (SPEED * elapsed) / 1000;
        // Half the track is one full copy of the strip, so wrapping there puts the
        // identical tile under the cursor and the seam is never visible.
        const half = node.scrollWidth / 2;
        if (half > 0) offset.current = ((offset.current % half) + half) % half;
        node.style.transform = `translateX(${offset.current - half}px)`;
      }
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  // One preset would leave most of the strip empty, so the list is repeated until it
  // is wide enough to look like a strip at all — and then doubled, for the wrap.
  // An agent's meta settings may narrow the catalogue; a list that narrowed it to
  // nothing is treated as no restriction, so the strip is never an empty rail.
  const offered = only.length
    ? MCP_PRESETS.filter((p) => only.includes(p.id))
    : MCP_PRESETS;
  const presets = offered.length ? offered : MCP_PRESETS;
  const filled = Array.from(
    { length: Math.max(1, Math.ceil(8 / presets.length)) },
    () => presets,
  ).flat();
  const tiles = [...filled, ...filled];

  return (
    <div
      onPointerEnter={() => (held.current = true)}
      onPointerLeave={() => {
        held.current = false;
        drag.current = null;
      }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX };
        moved.current = 0;
        captured.current = false;
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        drag.current = { x: e.clientX };
        moved.current += Math.abs(dx);
        offset.current += dx;
        // Now it is a drag: hold the pointer so it keeps working past the edges.
        if (!captured.current && moved.current > DRAG_SLOP) {
          captured.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }}
      onPointerUp={(e) => {
        if (captured.current)
          e.currentTarget.releasePointerCapture(e.pointerId);
        captured.current = false;
        drag.current = null;
      }}
      // The strip fades out at both edges rather than being cut off. A mask is used
      // instead of a gradient overlay because the section behind it is itself a
      // gradient, which an overlay in a flat colour would band against.
      className="cursor-grab touch-pan-y overflow-hidden py-0 select-none active:cursor-grabbing [mask-image:linear-gradient(to_right,transparent,black_40px,black_calc(100%-40px),transparent)]"
    >
      <div ref={track} className="flex w-max gap-3">
        {tiles.map((preset, i) => (
          <button
            key={`${preset.id}-${i}`}
            title={`Add ${preset.name}`}
            aria-label={`Add ${preset.name}`}
            onClick={() => {
              // A drag that ends on a tile is a drag, not a click on it.
              if (moved.current > DRAG_SLOP) return;
              onPick(preset);
            }}
            className="bg-canvas border-hairline text-ink hover:border-ink flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] border transition"
          >
            {preset.logo}
          </button>
        ))}
      </div>
    </div>
  );
}
