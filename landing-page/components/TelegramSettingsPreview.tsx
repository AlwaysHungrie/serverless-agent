/**
 * The agent's settings screen, redrawn rather than screenshotted: the Telegram
 * section as Settings actually draws it — the tinted card at the top of the page,
 * its switch on, and the credentials and whitelists it asks for. Every value here is
 * fixed sample content.
 */

/** Telegram blue, the tint `CapabilitySection` washes this section in. */
const TINT = "#229ED9";

export function TelegramSettingsPreview({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[24px] bg-canvas text-ink shadow-[0_18px_50px_-24px_rgba(20,20,20,0.25)] ring-1 ring-hairline ${className}`}
    >
      {/* Browser chrome, so a product shot reads as a product shot. */}
      <div className="flex items-center gap-1.5 border-b border-hairline-soft bg-white/60 px-4 py-3">
        <span className="size-2.5 rounded-full bg-hairline" />
        <span className="size-2.5 rounded-full bg-hairline" />
        <span className="size-2.5 rounded-full bg-hairline" />
        <span className="ml-3 flex h-5 min-w-0 items-center rounded-full bg-canvas-soft px-2.5 text-[10px] text-faint">
          /a/4ac067dd/settings
        </span>
      </div>

      {/* The tinted capability card. Its inputs are outlined rather than filled,
          the way a section on a tint draws them. */}
      <div
        style={{ ["--tint" as string]: TINT }}
        className="m-4 rounded-[24px] bg-linear-to-b from-[var(--tint)]/18 to-transparent px-4 py-5 sm:m-5 sm:px-5"
      >
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h4 className="text-[15px] font-semibold leading-[1.38]">
              Telegram
            </h4>
            <p className="mt-1 text-[13px] font-light leading-[1.43] text-muted">
              Talk to the agent on Telegram, in a DM or in a group.
            </p>
          </div>
          <Toggle />
        </div>

        <div className="mt-5 space-y-4">
          <Field label="Bot token" value="••••••••••••" />
          <Chips
            label="DM whitelist"
            hint="Usernames allowed to DM the bot. Empty allows everyone."
            entries={["@alice", "@bob"]}
          />
          <Chips
            label="Groups and Topics whitelist"
            hint="Groups and topics the bot can reply in, by group id or group_id:topic_id."
            entries={["-1001234567891", "-1001234567890:42"]}
          />
        </div>
      </div>
    </div>
  );
}

/** The switch, drawn on: this agent's bot is connected. */
function Toggle() {
  return (
    <span className="relative block h-7 w-12 shrink-0 rounded-full bg-ink">
      <span className="absolute left-6 top-1 size-5 rounded-full bg-canvas shadow-sm" />
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[13px] font-semibold leading-[1.43]">
        {label}
      </span>
      <span className="mt-2 block truncate rounded-[16px] border border-hairline bg-canvas px-4 py-3 text-[13px] text-ink">
        {value}
      </span>
    </div>
  );
}

function Chips({
  label,
  hint,
  entries,
}: {
  label: string;
  hint: string;
  entries: string[];
}) {
  return (
    <div>
      <span className="block text-[13px] font-semibold leading-[1.43]">
        {label}
      </span>
      <span className="block text-[11px] font-light leading-[1.33] text-muted">
        {hint}
      </span>
      <div className="mt-2 flex flex-wrap gap-2">
        {entries.map((e) => (
          <span
            key={e}
            className="flex items-center gap-2 rounded-full border border-hairline bg-canvas py-1.5 pl-3 pr-2 text-[12px] leading-[1.35]"
          >
            <span className="max-w-[160px] truncate">{e}</span>
            <span className="flex size-4 items-center justify-center rounded-full text-muted">
              ×
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
