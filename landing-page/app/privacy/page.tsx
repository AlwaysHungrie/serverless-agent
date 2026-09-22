import type { Metadata } from "next";

import { LegalPage } from "@/components/LegalPage";
import { BRAND } from "@/components/content";
import { PRIVACY } from "@/components/legal";

export const metadata: Metadata = {
  title: `${PRIVACY.title} — ${BRAND.name}`,
  description: `What ${BRAND.legalName} collects when you use ${BRAND.name}, why, and how to have it deleted.`,
};

export default function Page() {
  return <LegalPage doc={PRIVACY} />;
}
