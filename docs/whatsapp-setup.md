# Connecting a WhatsApp number to the Worker

This is the path that worked, in the order that worked, with the places it goes wrong.
Setting up the free test number takes about 20 minutes if you do not hit the pitfalls,
and most of that is waiting on Meta's dashboard.

Everything here is Meta-side configuration plus five values saved on the agent. There
is nothing to deploy and no secret to set on the Worker: the credentials live in the
agent's own config, the same way a Telegram bot token does, and the settings page is
where they go. The end-user version of these steps is at `/guides/whatsapp` in the app.

The code: `agent/src/whatsapp.ts` for the transport, `handleWhatsappWebhook` in
`agent/src/server.ts` for the route, `whatsappTurn` in `agent/src/agent.ts` for the
turn, and the `whatsapp` entry in `agent/src/capabilities.ts` for the settings fields.

## What you need before you start

- A Facebook account you can log into.
- A phone with WhatsApp installed, whose number will be the one allowed to talk to the
  agent.
- The Worker deployed somewhere with a public HTTPS URL. Meta calls the callback URL
  the moment you save it, so `wrangler dev` will not do. Use the staging Worker.

## The credentials you are collecting

By the end you will have five values, all entered on the agent's settings page under
WhatsApp. Every one is required, and a half-filled set counts as off: the route returns
404 rather than answering the handshake and then failing to verify a signature.

| Field | Where it comes from |
| --- | --- |
| Your WhatsApp number | The one number this agent answers. Country code included. |
| Phone number ID | WhatsApp → API Setup. A 15 to 17 digit id, not the phone number. |
| Access token | A system user token from Business Manager. Starts with `EAA`. |
| App secret | App Settings → Basic → App Secret. 32 hex characters. |
| Verify token | You invent it. `openssl rand -hex 16` is fine. |

Two more values are worth writing down even though the Worker does not read them: the
WhatsApp Business Account id (the WABA id) and the app id. You need both for the
subscription step, which is the step that fails silently.

## Step 1: create the app

Go to developers.facebook.com and create an app. In the use case picker, tick
**Connect with customers through WhatsApp** and untick everything else. Extra use cases
pull in permissions and required-action items you will never use.

The Business step will block you if you have no business portfolio: the warning reads
"No businesses available" and **Next** stays greyed out. Follow the **create a new one**
link, fill in a portfolio name, your real name, and an email you can receive at, then
confirm the email. Come back to the app creation tab, reload the page, and the portfolio
appears in the dropdown.

Portfolio verification is not required. The yellow warning about verification is about
third-party data access and publishing the app publicly, neither of which applies to a
private assistant on a test number.

## Step 2: read the phone number id

Open WhatsApp → **API Setup**. The panel shows the test number and, under it, a
**Phone number ID**. Copy the id, not the number. Note the Graph API version in the
sample curl on the same panel. The code pins a version in `GRAPH_VERSION` in
`agent/src/whatsapp.ts`; if the panel shows a newer one, that constant is where you
change it.

## Step 3: verify your own number as a recipient

In the same panel, open the **To** dropdown and choose **Manage phone number list**. Add
your number with its country code. WhatsApp sends a code to the phone; enter it.

The test number can only reach numbers on this list, up to five of them. Anyone else
gets nothing, with no error you will see.

## Step 4: send the template, then reply to it

A business cannot send free-form text to someone who has not messaged it in the last 24
hours. Before that first inbound message, only a pre-approved template will go through.
Send `hello_world` with the curl the API Setup panel gives you, or:

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/${WHATSAPP_PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"'"${WHATSAPP_ALLOWED_WA_ID}"'",
       "type":"template","template":{"name":"hello_world","language":{"code":"en_US"}}}'
```

A response containing `"message_status":"accepted"` means Meta took it. Check the phone.

Now **reply to it from the phone**. That opens the 24-hour window, and free-form sends
start working. Skip this and every later send fails with error code `131047`.

Confirm the window is open by sending plain text:

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/${WHATSAPP_PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"'"${WHATSAPP_ALLOWED_WA_ID}"'",
       "type":"text","text":{"preview_url":false,"body":"window check"}}'
```

## Step 5: get a permanent token

The token on the API Setup panel expires in 24 hours. The permanent one is a system user
token, and it is created in Business Manager, not in the app dashboard. This is the step
with the most ways to go wrong.

Go to business.facebook.com → your portfolio → **Settings** → **Users** →
**System users** → **Add**. Name it, give it the **Admin** role, create it.

Before generating a token, assign the assets. On the system user's row, click
**Assign assets**:

1. **Apps** → your app → toggle **Full control** → save.
2. **Assign assets** again → **WhatsApp accounts** → your WABA → **Full control** → save.

Then **Generate new token** → select your app → expiry **Never** → tick
`whatsapp_business_messaging` and `whatsapp_business_management`.

If the permissions step shows **"No permissions available. Assign an app role to the
system user, or select another app to continue."**, the app assignment in point 1 did
not save. Go back and redo it. The scopes only appear once the system user has a role on
the app.

If the Apps list has nothing to tick, the app belongs to a different portfolio. Fix that
in the app dashboard under App Settings → Basic → Business portfolio.

The token is shown once. Copy it immediately. Check what you got:

```bash
curl -s "https://graph.facebook.com/v23.0/debug_token?input_token=${TOKEN}&access_token=${TOKEN}" \
  | python3 -m json.tool
```

You want `"type": "SYSTEM_USER"`, `"is_valid": true`, `"expires_at": 0`, and both
`whatsapp_business_*` scopes. A token whose `expires_at` is not 0 is the temporary one.

## Step 6: the app secret

App dashboard → **App Settings** → **Basic** → App Secret → **Show**. It asks for your
Facebook password. The value is 32 hex characters.

The Worker checks every inbound delivery's `x-hub-signature-256` against this. A missing
app secret is treated as a refusal, not as a pass, so an unconfigured Worker rejects
everything rather than accepting unsigned traffic.

## Step 7: save the five values on the agent

Open the agent's settings page, turn on **WhatsApp**, and fill in all five fields. They
are stored in that agent's own config. The access token and the app secret are marked
secret, so they read back masked over the API rather than being handed out again.

Do this before the next step. Meta calls the callback URL as soon as you save it, and
the route stays 404 until the config is complete.

## Step 8: point Meta at the Worker

Do this only after all five fields are saved. Meta calls the URL as soon as you save it,
and a callback that fails verification is not saved.

WhatsApp → **Configuration** → Edit:

- Callback URL: `https://<your-worker>/whatsapp/webhook/<agentId>`
- Verify token: the verify token saved on the agent

The guide page at `/guides/whatsapp?agent=<agentId>` prints this URL filled in, which is
what the link in settings opens.

Test it yourself first, which is the same call Meta makes:

```bash
curl -s -w "\n%{http_code}\n" \
  "https://<your-worker>/whatsapp/webhook/<agentId>?hub.mode=subscribe&hub.verify_token=<verify token>&hub.challenge=1158201444"
```

You want `1158201444` followed by `200`. A wrong token gives 403. An unsigned POST to the
same path gives 401.

After saving, click **Manage** and subscribe the **`messages`** field. Saving the URL
alone delivers nothing.

## Step 9: subscribe the WABA to your app

This is the step that costs the most time, because everything looks configured and no
webhook ever arrives.

The field subscription in step 8 is an app-level setting. Separately, the WhatsApp
Business Account has to be subscribed to your app. A test number arrives subscribed to
Meta's own first-party app, so the list is not empty and nothing looks wrong.

Check what the WABA is subscribed to:

```bash
curl -s "https://graph.facebook.com/v23.0/${WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}"
```

If the only entry is `"WA DevX Webhook Events 1P App"`, your app is not subscribed.
Subscribe it, using your app's token:

```bash
curl -s -X POST "https://graph.facebook.com/v23.0/${WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}"
```

`{"success":true}` means done. Re-run the GET and your app should now appear in the
list. Message the test number from your phone and watch it land:

```bash
npx wrangler tail --env staging --format pretty
```

Note that `timeout` is not available on macOS, so run the tail as a plain background
command and stop it with `pkill -f "wrangler tail"` when you are finished.

## Pitfalls, in the order you will meet them

| Symptom | Cause | Fix |
| --- | --- | --- |
| **Next** is greyed out on the Business step | No business portfolio exists | Create one, confirm the email, reload the page |
| Sends fail with `131047` | Outside the 24-hour window | The user must message the number first; only templates work otherwise |
| Token stops working the next day | You kept the API Setup panel's temporary token | Generate a system user token with expiry **Never** |
| "No permissions available" when generating a token | The system user has no role on the app | Assign assets → Apps → Full control, then retry |
| Cannot find where to make a system user | It is in Business Manager, not the app dashboard | business.facebook.com → Settings → Users → System users |
| Saving the callback URL fails | Worker not deployed, variables missing, or verify token mismatch | Run the `hub.challenge` curl yourself and read the status code |
| Callback saved, field subscribed, still no webhooks | The WABA is not subscribed to your app | `POST /<WABA_ID>/subscribed_apps` |
| The route returns 404 | The capability is off, or one of the five fields is blank | All five, or the channel is off |
| Only you can be reached | Test numbers only reach verified recipients | Add the number to the recipient list, up to five |

## How the Worker behaves once it is connected

- **One number gets an answer, and it is the one in settings.** There is no whitelist:
  an agent on WhatsApp serves one person, so there is no empty state that could mean
  everyone and no second entry to add by mistake. Anyone else is ignored, with no reply
  and no session created.
- **Each agent has its own route and its own Meta app.** `/whatsapp/webhook/:agentId`,
  exactly like Telegram. What differs is that Meta has no API for setting a callback
  URL, so there is no `syncWebhook` equivalent and the URL is pasted in by hand.
- **Delivery receipts are ignored.** Meta posts sent, delivered and read events to the
  same callback. They carry no message, and answering them would mean answering the
  agent's own replies.
- **Repeat deliveries are answered once.** Meta re-sends anything that is not answered
  with a fast 200, and a slow turn is exactly what produces a retry. Each `wamid` is
  claimed in the agent's registry before the turn starts.
- **Replies over 4096 characters are split**, and only the first part quotes the message
  it answers.
- **A refused send outside the window is logged, not retried.** The turn still ran and
  is in the transcript, readable from the browser.
- **Text in, text and voice notes out.** Inbound media needs two more Graph calls to
  download and is not implemented. Outbound, the Voice notes capability lets the agent
  speak a reply: the audio is uploaded to Meta's media store first, then sent as Ogg
  Opus, which is the only container WhatsApp plays as a voice note rather than as a
  file. Drawn images still are not sent.
- **No groups.** Cloud API group messaging needs an Official Business Account, so every
  conversation is one person.

## Moving to a paid number later

The test number is a development resource. Meta can rotate or reclaim it, and it cannot
use custom templates. Moving to a number you own changes the phone number ID and the access token in
settings, and needs the subscription check in step 9 run again against the new WABA.
No code changes.
