import { Faq } from "@/components/Faq";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import {
  Capabilities,
  Costs,
  Cta,
  Features,
  Hero,
  Mission,
  Stats,
  Steps,
} from "@/components/sections";
import { Eyebrow, Wrap } from "@/components/ui";
import { Reveal } from "@/components/motion";

export default function Page() {
  return (
    <>
      <SiteHeader />

      {/* The sheet: opaque, above the footer, rounded where it lifts off it. */}
      <div id="top" className="relative z-10 rounded-b-[32px] bg-canvas">
        <main>
          <Hero />
          <Stats />
          <Features />
          <Mission />
          <Steps />
          <Costs />
          <Capabilities />

          <section id="faq" className="mt-32 scroll-mt-28">
            <Wrap>
              <Reveal>
                <div className="mx-auto max-w-[640px] text-center">
                  <Eyebrow>FAQ</Eyebrow>
                  <h2 className="mt-3 text-[clamp(30px,4.5vw,44px)] font-[650] leading-[1.08] tracking-[-0.025em]">
                    Everything people ask first.
                  </h2>
                </div>
              </Reveal>
              <Faq />
            </Wrap>
          </section>

          <Cta />
        </main>
      </div>

      {/* Scrolling past the sheet uncovers the fixed footer underneath. */}
      <div aria-hidden className="h-[var(--footer-h)]" />
      <SiteFooter />
    </>
  );
}
