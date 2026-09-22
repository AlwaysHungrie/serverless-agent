import type { Metadata } from "next";

import { LegalPage } from "@/components/LegalPage";
import { BRAND } from "@/components/content";
import { TERMS } from "@/components/legal";

export const metadata: Metadata = {
  title: `${TERMS.title} — ${BRAND.name}`,
  description: `The agreement between you and ${BRAND.legalName} for using ${BRAND.name}.`,
};

export default function Page() {
  return <LegalPage doc={TERMS} />;
}
