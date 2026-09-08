"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  CapabilitySection,
  visionBlockedNote,
} from "@/components/CapabilitySection";
import { McpServers } from "@/components/McpServers";
import type { Capability, Config, ModelOption } from "@/lib/agent";

export default function Capabilities() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Credentials save on a timer so a PATCH does not fire on every keystroke.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/config");
      const payload = (await res.json().catch(() => null)) as {
        config: Config;
        capabilities: Capability[];
        models: ModelOption[];
        error?: string;
      } | null;
      if (!res.ok || !payload) {
        setError(payload?.error ?? "Couldn't load your capabilities. Refresh the page to try again.");
        return;
      }
      setConfig(payload.config);
      // Telegram is connection setup, not a tool the agent calls: it lives in Settings.
      setCapabilities(payload.capabilities.filter((c) => c.id !== "telegram"));
      setModels(payload.models);
    })();
  }, []);

  const save = async (patch: Partial<Config>) => {
    setSaving(true);
    const res = await fetch("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    const payload = (await res.json().catch(() => null)) as {
      config: Config;
      error?: string;
    } | null;
    if (!res.ok || !payload) {
      setError(
        payload?.error ??
          "Couldn't save. The agent isn't responding. Try the switch again.",
      );
      return;
    }
    setConfig(payload.config);
    setError(null);
  };

  /** Apply locally right away, then persist — immediately, or debounced for text. */
  const set = (patch: Partial<Config>, wait = 0) => {
    setConfig((c) => (c ? { ...c, ...patch } : c));
    if (debounce.current) clearTimeout(debounce.current);
    if (wait === 0) {
      void save(patch);
      return;
    }
    debounce.current = setTimeout(() => void save(patch), wait);
  };

  const model = models.find((m) => m.id === config?.model) ?? null;

  return (
    <div className="bg-canvas text-ink min-h-screen">
      <div className="mx-auto w-full max-w-2xl px-5 py-10 md:px-8 md:py-14">
        <Link
          href="/"
          className="text-muted hover:text-ink mb-10 inline-flex items-center gap-2 text-[14px] transition"
        >
          <ArrowLeft size={16} strokeWidth={1.75} />
          Sessions
        </Link>

        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-[32px] font-[650] leading-[1.2]">
            Capabilities.
          </h1>
          <span className="text-faint text-[12px] leading-[1.33]">
            {saving ? "Saving…" : "Saved"}
          </span>
        </div>
        <p className="text-muted mt-1 text-[14px] font-light leading-[1.43]">
          Choose what the agent can do besides write. Applies to every
          session.
        </p>

        {error && (
          <div className="bg-canvas-soft border-hairline-soft mt-8 rounded-[16px] border px-5 py-4 text-[14px] leading-[1.43]">
            {error}
          </div>
        )}

        {!config && !error && (
          <p className="text-muted py-16 text-[14px] leading-[1.43]">
            Loading your capabilities…
          </p>
        )}

        {config && (
          <div className="mt-8">
            {capabilities.map((capability) => (
              <CapabilitySection
                key={capability.id}
                capability={capability}
                config={config}
                set={set}
                // Images only reach a model that can see them, so the switch is dead
                // until the chosen model is one of those.
                blocked={capability.id === "vision" && !model?.vision}
                blockedNote={visionBlockedNote(model?.label ?? "This model")}
              >
                {/* MCP is configured by the servers themselves, not by fields. */}
                {capability.id === "mcp" && <McpServers />}
              </CapabilitySection>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
