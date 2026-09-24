import Image from "next/image";

import { CopyField, VerifyTokenField } from "@/components/GuideFields";
import { AGENT_URL } from "@/lib/agent";

/**
 * How to get the five WhatsApp credentials the settings page asks for.
 *
 * A server component so it can print this deployment's real callback URL, which the
 * browser never learns: every API call goes through the Next proxy, and `AGENT_URL`
 * only exists on the server. With `?agent=<id>` it prints that agent's own route,
 * ready to paste into Meta's dashboard.
 *
 * The steps mirror docs/whatsapp-setup.md, which is the engineer's copy. This one is
 * for whoever owns the agent.
 */
export default async function WhatsappGuide({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const { agent } = await searchParams;
  // No agent id, no URL. The route carries the agent id in its path, so a guessed or
  // stale one points Meta at a different agent, whose verify token is a different
  // string: the handshake is refused and the dashboard blames the token. Rather than
  // hand out something that looks copyable, the page says where the real one is.
  const callback = agent
    ? `${AGENT_URL}/whatsapp/webhook/${encodeURIComponent(agent)}`
    : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <h1 className="text-2xl font-semibold leading-[1.25]">
        Connect your agent to WhatsApp
      </h1>
      <p className="text-muted mt-3 text-sm font-light leading-[1.5]">
        This guide will help you get a test phone number and set up your agent to use
        it.
      </p>

      <div className="mt-6">
        <Warn>
          <B>Disclaimer:</B> You are not allowed to share access to your agent with
          any WhatsApp account other than your own. Doing so violates our terms of
          use and Meta&rsquo;s, and your account will be suspended.
        </Warn>
      </div>

      <Callout>
        <p className="text-sm leading-[1.5]">What to expect:</p>
        <ul className="mt-2 ml-4 list-disc space-y-1.5 text-sm leading-[1.5]">
          <li>
            You will create a free developer account on Meta and get a test number.
            Your agent uses that number to message you on WhatsApp.
          </li>
          <li>
            Your agent will not work in WhatsApp groups, or with any account other
            than yours.
          </li>
          <li>
            Your agent can only reply within 24 hours of your last message to it. If
            you do not message it for a day, WhatsApp blocks whatever it tries to
            send you, including reminders and scheduled messages. Send it a message
            and it can reach you again.
          </li>
        </ul>
      </Callout>

      <Step n={1} title="Create a Meta app">
        <p>
          Sign in to{" "}
          <A href="https://developers.facebook.com/apps">developers.facebook.com</A>{" "}
          and create a new app.
        </p>
        <Shot
          src="/guides/whatsapp/step1-create-app.png"
          width={1936}
          height={1042}
          alt="The Meta apps dashboard with the Create App button"
        />
        <p>This opens a five step app creation process.</p>
        <ol className="ml-4 list-decimal space-y-3">
          <li>Enter an app name. &ldquo;My Agent&rdquo; is fine.</li>
          <li>
            Under use cases, pick <B>Business messaging</B>, then{" "}
            <B>Connect with customers through WhatsApp</B>.
            <Shot
              src="/guides/whatsapp/step1-use-cases.png"
              width={2072}
              height={974}
              alt="The use case picker with Business messaging and Connect with customers through WhatsApp selected"
            />
          </li>
          <li>
            On the Business step:
            <ol className="mt-2 ml-4 list-[lower-alpha] space-y-3">
              <li>
                Create a business portfolio. Name it <B>My Agent</B> and enter your
                contact details.
                <Shot
                  src="/guides/whatsapp/step1-portfolio.png"
                  width={1200}
                  height={1040}
                  alt="The Create a business portfolio dialog"
                />
              </li>
              <li>
                Verification is not required. Click <B>Verify later</B>.
                <Shot
                  src="/guides/whatsapp/step1-verify-later.png"
                  width={1200}
                  height={698}
                  alt="The portfolio created dialog with Verify later and Start verification buttons"
                />
              </li>
              <li>Select the portfolio you just created.</li>
            </ol>
          </li>
          <li>
            Requirements: if everything so far is right, you will see &ldquo;No
            requirements identified. This may change if you add more to this
            app.&rdquo; Click <B>Next</B>.
          </li>
          <li>
            Review your details and click <B>Create app</B>.
            <Shot
              src="/guides/whatsapp/step1-review.png"
              width={1996}
              height={894}
              alt="The review screen showing the WhatsApp use case, the business portfolio and the Create app button"
            />
          </li>
        </ol>
      </Step>

      <Step n={2} title="Open the WhatsApp use case">
        <p>
          Click <B>Use cases</B> in the left sidebar.
        </p>
        <Shot
          src="/guides/whatsapp/step2-sidebar.png"
          width={588}
          height={894}
          alt="The app dashboard sidebar with Use cases in the list"
          narrow
        />
        <p>
          Then click the customize button, the pencil icon, on the{" "}
          <B>Connect with customers through WhatsApp</B> card.
        </p>
        <Shot
          src="/guides/whatsapp/step2-customize.png"
          width={1856}
          height={426}
          alt="The WhatsApp use case card with the pencil customize button on the right"
        />
      </Step>

      <Step n={3} title="Request a test phone number">
        <p>
          Step 2 takes you to a new page. Check that the right business portfolio is
          selected, then click <B>Continue</B>.
        </p>
        <Shot
          src="/guides/whatsapp/step3-portfolio.png"
          width={732}
          height={990}
          alt="The WhatsApp Business Platform panel with the business portfolio dropdown and a Continue button"
        />
        <p>
          This opens a three step overview. You only need steps 1 and 2 of it. Click{" "}
          <B>Step 1. Try it out</B>.
        </p>
        <Shot
          src="/guides/whatsapp/step3-overview.png"
          width={1604}
          height={1026}
          alt="The WhatsApp overview page listing Try it out, Production setup and Business verification"
        />
      </Step>

      <Step
        n={4}
        title="Copy the phone number ID and optionally send a test message"
      >
        <ol className="ml-4 list-[lower-alpha] space-y-3">
          <li>
            Copy the <B>Phone number ID</B> and the{" "}
            <B>WhatsApp Business account ID</B>, and add both to your agent&rsquo;s
            settings. The account ID is what lets your agent subscribe itself to the
            account&rsquo;s messages when you save, which is what makes replies
            arrive.
            <Shot
              src="/guides/whatsapp/step4-test-number.png"
              width={1604}
              height={834}
              alt="The Try it out panel showing the test number, phone number ID and WhatsApp Business account ID"
            />
          </li>
          <li>
            Optionally, send yourself a test message from the new number. Click{" "}
            <B>Generate token</B>, choose{" "}
            <B>Opt in to all current and future WhatsApp accounts</B>,{" "}
            <B>Continue</B>, then <B>Save</B>.
            <Shot
              src="/guides/whatsapp/step4-optin.png"
              width={1118}
              height={1224}
              alt="The opt in dialog with all current and future WhatsApp accounts selected"
            />
            Then click <B>Select a recipient number</B> →{" "}
            <B>Manage phone number list</B>, add your phone number and confirm the
            code WhatsApp sends you. Click <B>Send message</B> and it arrives on your
            phone.
            <Shot
              src="/guides/whatsapp/step5-send-message.png"
              width={1188}
              height={380}
              alt="The Hello World message dropdown with the Send message button"
            />
          </li>
        </ol>
      </Step>

      <Step n={5} title="Make a permanent access token">
        <p>
          Go to{" "}
          <A href="https://business.facebook.com/settings">business.facebook.com</A>{" "}
          and select the business portfolio you created in step 1.
        </p>
        <p>
          Click the settings icon at the bottom left of the sidebar. A second sidebar
          opens: select <B>System users</B> and create a new system user named{" "}
          <B>Salts</B> with the <B>Admin</B> role.
        </p>
        <p>
          Once it is created, click <B>Assign assets</B>.
        </p>
        <Shot
          src="/guides/whatsapp/step5-assign-assets.png"
          width={1004}
          height={1022}
          alt="The system user page with no assets assigned and an Assign assets button"
        />
        <p>
          In the dialog, select your app and your WhatsApp account, and turn on{" "}
          <B>Full access</B> for both.
        </p>
        <Shot
          src="/guides/whatsapp/step5-full-access.png"
          width={1790}
          height={1108}
          alt="The Select assets and assign permissions dialog with the WhatsApp account selected and Full access on"
        />
        <p>
          Now click <B>Generate token</B> and follow the process. Select your app,
          then set the expiry to <B>Never</B>.
        </p>
        <Shot
          src="/guides/whatsapp/step5-expiry.png"
          width={1596}
          height={1138}
          alt="The token expiry screen with Never selected"
        />
        <p>
          On the permissions screen, select every permission in the list.
        </p>
        <Shot
          src="/guides/whatsapp/step5-permissions.png"
          width={1596}
          height={1138}
          alt="The assign permissions screen with all options selected"
        />
        <Warn>
          If that screen says <B>&ldquo;No permissions available&rdquo;</B>, the app
          assignment did not save. Go back to <B>Assign assets</B>, turn on Full
          access for the app again, then retry. The permissions only appear once the
          system user has access to the app.
        </Warn>
        <p>
          The token is shown once. Copy it into the <B>Access token</B> field in your
          agent&rsquo;s settings before closing the dialog.
        </p>
      </Step>

      <Step n={6} title="Get the app secret">
        <p>
          Go back to{" "}
          <A href="https://developers.facebook.com/apps">developers.facebook.com</A>.
          In the left sidebar, open <B>App settings</B> and select <B>Basic</B>.
        </p>
        <Shot
          src="/guides/whatsapp/step6-sidebar.png"
          width={594}
          height={1178}
          alt="The app dashboard sidebar with App settings expanded and Basic selected"
          narrow
        />
        <p>
          Click <B>Show</B> next to App secret. Copy the value into the{" "}
          <B>App secret</B> field in your agent&rsquo;s settings.
        </p>
        <Shot
          src="/guides/whatsapp/step6-app-secret.png"
          width={870}
          height={188}
          alt="The App secret field with a Show button"
        />
      </Step>

      <Step n={7} title="Configure the webhook">
        <p>
          Go back to the tab you left in step 4, the one with the three step
          overview. Click <B>Step 2. Production setup</B>.
        </p>
        <p>Add this callback URL:</p>
        {callback ? (
          <>
            <CopyField value={callback} />
            <p className="text-faint text-xs leading-[1.4]">
              This URL is for agent <Mono>{agent}</Mono>. Check that is the agent
              whose settings you are filling in — each agent has its own route and
              its own verify token, and Meta refuses the handshake if they belong to
              different agents.
            </p>
          </>
        ) : (
          <Warn>
            This page does not know which agent you are setting up, and the callback
            URL is different for every agent. Open the guide from your agent&rsquo;s
            settings, using the <B>Whatsapp setup guide</B> button, and the URL to
            copy appears here.
          </Warn>
        )}
        <p>
          Add this verify token underneath, then click <B>Verify and save</B>:
        </p>
        <VerifyTokenField />
        <p>
          Copy the same verify token into the <B>Verify token</B> field in your
          agent&rsquo;s settings. The two have to match exactly, and Meta calls the
          URL as soon as you save, so save your agent&rsquo;s settings first.
        </p>
        <p>
          Then click <B>Manage</B> and subscribe the <Mono>messages</Mono> field.
          Saving the URL on its own delivers nothing.
        </p>
      </Step>

      <h2 className="mt-12 text-lg font-semibold leading-[1.35]">
        You are done
      </h2>
      <div className="text-muted mt-4 space-y-3 text-sm font-light leading-[1.5]">
        <p>
          Message the test number from your phone. Your agent answers in the same
          chat, with the same memory, tools and settings it has in your browser, and
          the conversation shows up in your sessions like any other.
        </p>
        <p>
          Keep the 24 hour window in mind: if you have not messaged your agent for a
          day, WhatsApp will not let it reach you until you do.
        </p>
      </div>

      <h2 className="mt-12 text-lg font-semibold leading-[1.35]">Disclaimer</h2>
      <div className="text-muted mt-4 space-y-3 text-sm font-light leading-[1.5]">
        <p>
          If messages stop going through, check{" "}
          <A href="https://business.facebook.com">business.facebook.com</A> for
          account suspension notices.
        </p>
        <p>
          Creating more than one unverified business portfolio can get the newer
          portfolios suspended automatically. You may have to verify your business to
          get them back.
        </p>
        <p>
          If you would rather use a second number of your own than the test number
          WhatsApp provides, you can add and verify it on the same page as step 7.
          That one is left to you.
        </p>
      </div>
    </main>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-hairline-soft mt-10 border-t pt-8">
      <h2 className="text-base font-semibold leading-[1.38]">
        <span className="text-faint mr-2 tabular-nums">{n}</span>
        {title}
      </h2>
      <div className="text-muted mt-3 space-y-3 text-sm font-light leading-[1.5]">
        {children}
      </div>
    </section>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-canvas-soft mt-6 rounded-2xl px-5 py-4">{children}</div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-hairline bg-canvas rounded-2xl border px-4 py-3 text-sm leading-[1.5]">
      {children}
    </p>
  );
}

function Shot({
  src,
  width,
  height,
  alt,
  narrow,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  narrow?: boolean;
}) {
  return (
    <Image
      src={src}
      width={width}
      height={height}
      alt={alt}
      className={`border-hairline mt-3 h-auto w-full rounded-xl border ${narrow ? "max-w-[260px]" : ""}`}
    />
  );
}

const Mono = ({ children }: { children: React.ReactNode }) => (
  <code className="bg-canvas-soft rounded px-1.5 py-0.5 text-[0.85em]">
    {children}
  </code>
);

const B = ({ children }: { children: React.ReactNode }) => (
  <strong className="text-ink font-semibold">{children}</strong>
);

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="text-ink underline underline-offset-2"
  >
    {children}
  </a>
);
