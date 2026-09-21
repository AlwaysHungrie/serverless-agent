# landing-page

Marketing page for Salt Agents. Next.js 16 (App Router) + Tailwind v4 + Framer Motion.

```bash
pnpm install
pnpm dev      # http://localhost:4000
pnpm build && pnpm start
```

Design tokens (colors, radii, type weights) live in `app/globals.css` and mirror
`frontend/DESIGN.md`, so the page and the app read as one system. Inter stands in for
Saans at 300 / 450 / 600 / 650.

## Layout notes

- **Footer reveal** — the footer is `fixed` at the viewport floor (`SiteFooter.tsx`),
  the page content is an opaque sheet above it, and an empty spacer the height of the
  footer lets the sheet scroll off and uncover it. Height is `--footer-h` in
  `globals.css`; change it in one place and both sides follow.
- **Motion** — entry reveals only (`components/motion.tsx`), the header's scroll state,
  and the FAQ accordion. All of it honours `prefers-reduced-motion`.
- **Placeholders** — every image slot is a labelled block, framed with browser chrome
  where a product shot belongs. Replace them before this ships, along with the
  `href="#"` links.
