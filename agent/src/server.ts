import { routeAgentRequest } from "agents";
import { MODELS, type Env } from "./agent";
import { Telegram, allowedBy, chatTitle, topicId, type TelegramUpdate } from "./telegram";
import {
  CAPABILITIES,
  SECRET_MASK,
  TELEGRAM_WHITELIST_DEFAULTS,
  type CapabilityField,
} from "./capabilities";
import { EMPTY_MCP_SERVER, type Config } from "./registry";
import {
  discoverAuthServer,
  exchangeCode,
  parseHeaders,
  parseTools,
  parseNames,
  pkceChallenge,
  randomToken,
  registerClient,
  type McpAuth,
  type McpServerRow,
  type McpServerView,
} from "./mcp";
import { mcpServerReady, withMcpAuth } from "./capabilities";

export { SessionAgent } from "./agent";
export { SessionRegistry } from "./registry";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,PATCH,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function registry(env: Env) {
  return env.SessionRegistry.get(env.SessionRegistry.idFromName("global"));
}

/**
 * The webhook's shared secret. Telegram echoes it on every call, and it is derived
 * from the bot token so there is nothing extra for anyone to store or paste.
 */
async function webhookSecret(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function withCors(res: Response) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

const REASONING_EFFORTS = ["off", "low", "medium", "high"] as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Every capability toggle, and every credential field any capability declares. */
const CAPABILITY_FLAGS = CAPABILITIES.map((c) => c.flag);
const CAPABILITY_FIELDS: CapabilityField[] = CAPABILITIES.flatMap((c) => c.fields);

/**
 * Keep the settings row trustworthy: the agent reads it straight into an OpenRouter
 * request, so every value is checked and clamped here rather than at the call site.
 * Only the keys actually present are returned, so a PATCH stays a partial update.
 */
function validateConfig(body: Partial<Config>): Partial<Config> {
  const patch: Partial<Config> = {};

  if (body.model !== undefined) {
    if (!MODELS.some((m) => m.id === body.model)) throw new Error(`unknown model: ${body.model}`);
    patch.model = body.model;
  }
  if (body.system_prompt !== undefined) {
    if (typeof body.system_prompt !== "string") throw new Error("system_prompt must be a string");
    patch.system_prompt = body.system_prompt.slice(0, 4000);
  }
  if (body.temperature !== undefined) {
    if (!Number.isFinite(body.temperature)) throw new Error("temperature must be a number");
    patch.temperature = clamp(body.temperature, 0, 2);
  }
  if (body.max_tokens !== undefined) {
    if (!Number.isFinite(body.max_tokens)) throw new Error("max_tokens must be a number");
    patch.max_tokens = Math.round(clamp(body.max_tokens, 0, 32000));
  }
  if (body.reasoning_effort !== undefined) {
    if (!REASONING_EFFORTS.includes(body.reasoning_effort)) {
      throw new Error(`unknown reasoning effort: ${body.reasoning_effort}`);
    }
    patch.reasoning_effort = body.reasoning_effort;
  }
  if (body.context_messages !== undefined) {
    if (!Number.isFinite(body.context_messages)) throw new Error("context_messages must be a number");
    patch.context_messages = Math.round(clamp(body.context_messages, 0, 200));
  }

  for (const flag of CAPABILITY_FLAGS) {
    if (body[flag] !== undefined) (patch[flag] as number) = body[flag] ? 1 : 0;
  }

  for (const field of CAPABILITY_FIELDS) {
    const value = body[field.key];
    if (value === undefined) continue;
    if (typeof value !== "string") throw new Error(`${field.key} must be a string`);
    // The mask is what a secret reads back as, so it means "leave this one alone".
    if (field.secret && value === SECRET_MASK) continue;
    let cleaned = value.trim();
    // A Telegram handle is written with an @ everywhere it is shown, so the field
    // accepts one — but the stored form is bare: links and mention matching build
    // the @ back themselves.
    if (field.key === "telegram_bot_username") cleaned = cleaned.replace(/^@+/, "");
    // A list holds many entries, so it gets more room than a single credential.
    (patch[field.key] as string) = cleaned.slice(0, field.list ? 8000 : 1000);
  }

  return patch;
}

/** Config as the browser may see it: secrets become a mask, never the key itself. */
function redact(config: Config): Config {
  const safe = { ...config };
  for (const field of CAPABILITY_FIELDS) {
    if (!field.secret) continue;
    (safe[field.key] as string) = String(config[field.key] ?? "") ? SECRET_MASK : "";
  }
  return safe;
}

/**
 * Point the bot at this Worker, or unhook it when the capability is switched off.
 * Best effort: a bad token is reported back to the settings page, not thrown, because
 * the rest of the save has already happened.
 */
async function syncWebhook(
  config: Config,
  origin: string,
  api?: string
): Promise<{ ok: boolean; error?: string } | undefined> {
  if (!config.telegram_bot_token) return undefined;
  const bot = new Telegram(config.telegram_bot_token, api);
  try {
    if (config.cap_telegram) {
      await bot.setWebhook(`${origin}/telegram/webhook`, await webhookSecret(config.telegram_bot_token));
    } else {
      await bot.deleteWebhook();
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}


/* ------------------------------------------------------------ mcp servers -- */

/** Where the authorization server sends the browser back to. Always this Worker. */
const redirectUri = (origin: string) => `${origin}/api/mcp/oauth/callback`;

/** A server as the browser may see it: header values and tokens stay in the Worker. */
function mcpView(row: McpServerRow): McpServerView {
  const {
    oauth_client_secret: _secret,
    oauth_access_token: token,
    oauth_refresh_token: _refresh,
    oauth_verifier: _verifier,
    oauth_state: _state,
    headers,
    tools_json,
    disabled_tools,
    ...rest
  } = row;
  return {
    ...rest,
    header_names: Object.keys(parseHeaders(headers)),
    tools: parseTools(tools_json),
    disabled_tools: parseNames(disabled_tools),
    connected: row.auth !== "oauth" || token !== "",
  };
}

/**
 * Ask a server what it can do, and cache the answer on its row.
 *
 * This is what turns a URL into usable tools, so it runs on save, after an OAuth
 * connection, and whenever the user asks for a refresh. A failure is recorded rather
 * than thrown: the card shows why, and the server stays editable.
 */
async function syncMcpTools(
  reg: ReturnType<typeof registry>,
  row: McpServerRow
): Promise<McpServerRow> {
  if (!mcpServerReady(row)) {
    return (await reg.updateMcpServer(row.id, { tools_json: "", last_error: "" })) ?? row;
  }
  try {
    const tools = await withMcpAuth(row, reg, (client) => client.listTools());
    return (
      (await reg.updateMcpServer(row.id, {
        tools_json: JSON.stringify(tools),
        tools_synced_at: Date.now(),
        last_error: "",
      })) ?? row
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (await reg.updateMcpServer(row.id, { last_error: message })) ?? row;
  }
}

/** What a PATCH or POST may set. Credentials aside, every field is user-editable. */
function validateMcpBody(body: Record<string, unknown>): Partial<McpServerRow> {
  const patch: Partial<McpServerRow> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw new Error("name is required");
    patch.name = name.slice(0, 60);
  }
  if (body.url !== undefined) {
    const raw = String(body.url).trim();
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`"${raw}" is not a valid URL`);
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      // Credentials travel on every call, so the transport has to be encrypted.
      throw new Error("an MCP server URL must be https");
    }
    patch.url = parsed.toString();
  }
  if (body.auth !== undefined) {
    const auth = String(body.auth) as McpAuth;
    if (!["none", "headers", "oauth"].includes(auth)) throw new Error(`unknown auth: ${auth}`);
    patch.auth = auth;
  }
  if (body.headers !== undefined) {
    // Headers arrive as an object; a value left as the mask keeps the stored one.
    if (typeof body.headers !== "object" || body.headers === null) {
      throw new Error("headers must be an object");
    }
    patch.headers = JSON.stringify(body.headers).slice(0, 8000);
  }
  if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;
  if (body.disabled_tools !== undefined) {
    if (!Array.isArray(body.disabled_tools)) throw new Error("disabled_tools must be an array");
    patch.disabled_tools = JSON.stringify(
      body.disabled_tools.filter((n): n is string => typeof n === "string")
    ).slice(0, 8000);
  }

  return patch;
}

/**
 * Names have to be distinct: a server's name is the prefix its tools reach the model
 * under, so two servers called the same thing would offer the model two different
 * tools under one name.
 */
async function assertNameFree(
  reg: ReturnType<typeof registry>,
  name: string,
  exceptId?: string
): Promise<void> {
  const taken = (await reg.mcpServers()).some(
    (s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase()
  );
  if (taken) throw new Error(`A server with name "${name}" already exists`);
}

/**
 * Merge a headers patch over what is stored, so a value the browser sent back as the
 * mask is left alone — the same contract the config secrets follow.
 */
function mergeHeaders(current: string, incoming: string): string {
  const stored = parseHeaders(current);
  const next = parseHeaders(incoming);
  for (const [key, value] of Object.entries(next)) {
    if (value === SECRET_MASK && stored[key] !== undefined) next[key] = stored[key];
  }
  return JSON.stringify(next);
}

/**
 * Begin an OAuth connection: discover the provider's endpoints, register this app as
 * a client if it has not been already, and hand back the URL to send the user to.
 *
 * The PKCE verifier and the CSRF state are parked on the row; the callback is the
 * only thing that reads them, and it clears them once the tokens are in.
 */
async function startMcpOauth(
  reg: ReturnType<typeof registry>,
  row: McpServerRow,
  origin: string,
  returnTo: string
): Promise<string> {
  const redirect = redirectUri(origin);
  const { metadata, resource } = await discoverAuthServer(row.url);
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error("that server does not advertise an OAuth authorization endpoint");
  }

  let clientId = row.oauth_client_id;
  let clientSecret = row.oauth_client_secret;
  // A client registered against a different authorization server is no client at all.
  if (!clientId || row.oauth_authorize_url !== metadata.authorization_endpoint) {
    if (!metadata.registration_endpoint) {
      throw new Error("that server supports neither a saved client nor dynamic registration");
    }
    const registered = await registerClient(metadata.registration_endpoint, redirect);
    clientId = registered.client_id;
    clientSecret = registered.client_secret ?? "";
  }

  const verifier = randomToken();
  const state = randomToken(16);
  await reg.updateMcpServer(row.id, {
    auth: "oauth",
    oauth_client_id: clientId,
    oauth_client_secret: clientSecret,
    oauth_authorize_url: metadata.authorization_endpoint,
    oauth_token_url: metadata.token_endpoint,
    oauth_registration_url: metadata.registration_endpoint ?? "",
    oauth_resource: resource,
    oauth_scope: (metadata.scopes_supported ?? []).join(" "),
    oauth_verifier: verifier,
    oauth_state: state,
    oauth_return_to: returnTo,
    last_error: "",
  });

  const authorize = new URL(metadata.authorization_endpoint);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirect);
  authorize.searchParams.set("code_challenge", await pkceChallenge(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("state", state);
  // RFC 8707: bind the token to this server, so it is useless anywhere else.
  if (resource) authorize.searchParams.set("resource", resource);
  const scopes = (metadata.scopes_supported ?? []).join(" ");
  if (scopes) authorize.searchParams.set("scope", scopes);
  return authorize.toString();
}

/**
 * The provider sends the browser back here with a code. It is traded for tokens, the
 * server's tools are read straight away, and the user lands back on the page they
 * started from — connected, or with the reason it failed on the card.
 */
async function handleOauthCallback(url: URL, env: Env): Promise<Response> {
  const reg = registry(env);
  const state = url.searchParams.get("state") ?? "";
  const row = await reg.mcpServerByState(state);
  // No row for this state means a stale or forged callback; there is nothing to do.
  if (!row) return new Response("unknown or expired authorization state", { status: 400 });

  const back = new URL(row.oauth_return_to || `${url.origin}/`);
  const fail = async (message: string) => {
    await reg.updateMcpServer(row.id, { oauth_state: "", oauth_verifier: "", last_error: message });
    back.searchParams.set("mcp_error", message);
    return Response.redirect(back.toString(), 302);
  };

  const error = url.searchParams.get("error");
  if (error) return await fail(url.searchParams.get("error_description") ?? error);
  const code = url.searchParams.get("code") ?? "";
  if (!code) return await fail("the provider returned no authorization code");

  try {
    const tokens = await exchangeCode(row.oauth_token_url, {
      code,
      clientId: row.oauth_client_id,
      clientSecret: row.oauth_client_secret || undefined,
      redirectUri: redirectUri(url.origin),
      verifier: row.oauth_verifier,
      resource: row.oauth_resource || undefined,
    });
    const connected = await reg.updateMcpServer(row.id, {
      oauth_access_token: tokens.access_token,
      oauth_refresh_token: tokens.refresh_token ?? "",
      oauth_expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : 0,
      oauth_scope: tokens.scope ?? row.oauth_scope,
      oauth_verifier: "",
      oauth_state: "",
      last_error: "",
    });
    if (connected) await syncMcpTools(reg, connected);
    back.searchParams.set("mcp_connected", row.name);
    return Response.redirect(back.toString(), 302);
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err));
  }
}

/** Everything under /api/mcp. Returns undefined when the path is not one of these. */
async function handleMcp(
  request: Request,
  env: Env,
  url: URL,
  segments: string[]
): Promise<Response | undefined> {
  const reg = registry(env);
  const id = segments[2];

  // The provider's redirect lands here, so it is matched before the :id routes.
  if (id === "oauth" && segments[3] === "callback") return await handleOauthCallback(url, env);

  if (request.method === "GET" && !id) {
    const servers = await reg.mcpServers();
    return withCors(
      Response.json({
        servers: servers.map(mcpView),
        /** Shown on the page, because a provider may ask for it when registering by hand. */
        redirect_uri: redirectUri(url.origin),
      })
    );
  }

  if (request.method === "POST" && !id) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    let patch: Partial<McpServerRow>;
    try {
      patch = validateMcpBody(body);
    } catch (err) {
      return withCors(Response.json({ error: (err as Error).message }, { status: 400 }));
    }
    if (!patch.name || !patch.url) {
      return withCors(Response.json({ error: "name and url are required" }, { status: 400 }));
    }
    try {
      await assertNameFree(reg, patch.name);
    } catch (err) {
      return withCors(Response.json({ error: (err as Error).message }, { status: 409 }));
    }
    const row: McpServerRow = {
      ...EMPTY_MCP_SERVER,
      id: crypto.randomUUID().slice(0, 8),
      created_at: Date.now(),
      name: patch.name,
      url: patch.url,
      auth: patch.auth ?? "none",
      headers: patch.headers ?? "",
      enabled: patch.enabled ?? 1,
    };
    await reg.addMcpServer(row);
    // OAuth has nothing to list yet — the tools are read once the user has approved.
    const synced = row.auth === "oauth" ? row : await syncMcpTools(reg, row);
    return withCors(Response.json({ server: mcpView(synced) }));
  }

  if (id && segments[3] === "connect" && request.method === "POST") {
    const row = await reg.mcpServer(id);
    if (!row) return withCors(Response.json({ error: "no such server" }, { status: 404 }));
    const { return_to } = (await request.json().catch(() => ({}))) as { return_to?: string };
    try {
      const authorizeUrl = await startMcpOauth(reg, row, url.origin, return_to ?? "");
      return withCors(Response.json({ authorize_url: authorizeUrl }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await reg.updateMcpServer(id, { last_error: message });
      return withCors(Response.json({ error: message }, { status: 502 }));
    }
  }

  // Forget the tokens without forgetting the server: the URL and name stay put, so
  // reconnecting is one click rather than a re-entry.
  if (id && segments[3] === "disconnect" && request.method === "POST") {
    const row = await reg.updateMcpServer(id, {
      oauth_access_token: "",
      oauth_refresh_token: "",
      oauth_expires_at: 0,
      oauth_verifier: "",
      oauth_state: "",
      tools_json: "",
      last_error: "",
    });
    if (!row) return withCors(Response.json({ error: "no such server" }, { status: 404 }));
    return withCors(Response.json({ server: mcpView(row) }));
  }

  if (id && segments[3] === "refresh" && request.method === "POST") {
    const row = await reg.mcpServer(id);
    if (!row) return withCors(Response.json({ error: "no such server" }, { status: 404 }));
    return withCors(Response.json({ server: mcpView(await syncMcpTools(reg, row)) }));
  }

  if (id && request.method === "PATCH") {
    const existing = await reg.mcpServer(id);
    if (!existing) return withCors(Response.json({ error: "no such server" }, { status: 404 }));
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    let patch: Partial<McpServerRow>;
    try {
      patch = validateMcpBody(body);
    } catch (err) {
      return withCors(Response.json({ error: (err as Error).message }, { status: 400 }));
    }
    if (patch.name && patch.name !== existing.name) {
      try {
        await assertNameFree(reg, patch.name, id);
      } catch (err) {
        return withCors(Response.json({ error: (err as Error).message }, { status: 409 }));
      }
    }
    if (patch.headers !== undefined) patch.headers = mergeHeaders(existing.headers, patch.headers);
    // Pointing the server somewhere else invalidates the tokens issued for the old
    // one, so a moved URL starts unconnected rather than quietly unauthorized.
    if (patch.url && patch.url !== existing.url) {
      Object.assign(patch, {
        oauth_access_token: "",
        oauth_refresh_token: "",
        oauth_expires_at: 0,
        tools_json: "",
      });
    }
    const updated = await reg.updateMcpServer(id, patch);
    if (!updated) return withCors(Response.json({ error: "no such server" }, { status: 404 }));
    // Only a change the server itself would answer differently is worth a round trip;
    // renaming one, or switching one of its tools off, is not.
    const rereads = ["url", "auth", "headers", "enabled"] as const;
    const changed = rereads.some((key) => patch[key] !== undefined);
    return withCors(
      Response.json({ server: mcpView(changed ? await syncMcpTools(reg, updated) : updated) })
    );
  }

  if (id && request.method === "DELETE") {
    await reg.removeMcpServer(id);
    return withCors(Response.json({ ok: true }));
  }

  return undefined;
}

/**
 * One Telegram update. The chat is resolved to its session — created on first
 * contact — and the message is handed to that session's own agent, which answers in
 * the chat itself. Telegram retries anything that is not a fast 200, so the turn runs
 * after the response rather than under it.
 */
async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const reg = registry(env);
  const config = await reg.config(env.MODEL);
  if (!config.cap_telegram || !config.telegram_bot_token) {
    return new Response("telegram is off", { status: 404 });
  }
  const offered = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (offered !== (await webhookSecret(config.telegram_bot_token))) {
    return new Response("bad secret", { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const message = update?.message;
  // Edits are ignored: answering them again would double every correction.
  if (!message?.chat) return new Response("ok");

  const chatId = String(message.chat.id);
  // A forum topic is a conversation of its own, so it keys a session of its own.
  const topic = topicId(message);
  const threadId = topic ? String(topic) : "";

  // The whitelists, when filled in, decide who gets an answer: a DM is judged by who
  // sent it, a group by which group — and which topic of it — the message is in. An
  // update from anywhere else is dropped silently, before a session exists for it.
  const allowed =
    message.chat.type === "private"
      ? allowedBy(config.telegram_user_whitelist, [
        message.from?.username,
        message.from?.id !== undefined ? String(message.from.id) : undefined,
      ])
      : allowedBy(config.telegram_group_whitelist, [
        threadId ? `${chatId}:${threadId}` : chatId,
        chatId,
        message.chat.username,
      ]);
  if (!allowed) return new Response("ok");

  const existing = await reg.forChat(chatId, threadId);
  const sessionId = existing?.id ?? (await reg.freeChatSessionId(chatId, threadId));
  if (!existing) {
    await reg.create(sessionId, chatTitle(message), env.SessionAgent.idFromName(sessionId).toString(), {
      source: "telegram",
      chat_id: chatId,
      chat_type: message.chat.type,
      // A public group links by handle; a private one links by its internal id.
      chat_username: message.chat.type === "private" ? "" : (message.chat.username ?? ""),
      chat_thread_id: threadId,
    });
  }
  await reg.touch(sessionId);

  const url = new URL(request.url);
  const turn = routeAgentRequest(
    new Request(`${url.origin}/agents/session-agent/${sessionId}/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    }),
    env
  );
  // Telegram is told the update landed straight away; the answer arrives in the chat.
  ctx.waitUntil(turn);
  return new Response("ok", { headers: { "x-session": sessionId } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);

    // App settings live in the registry object, next to the session index.
    if (segments[0] === "api" && segments[1] === "config") {
      const reg = registry(env);
      if (request.method === "GET") {
        return withCors(
          Response.json({
            config: redact(await reg.config(env.MODEL)),
            models: MODELS,
            capabilities: CAPABILITIES,
          })
        );
      }
      if (request.method === "PATCH") {
        const body = (await request.json()) as Partial<Config>;
        let patch: Partial<Config>;
        try {
          patch = validateConfig(body);
        } catch (err) {
          return withCors(Response.json({ error: (err as Error).message }, { status: 400 }));
        }
        // Switching Telegram on with both whitelists empty would let all of Telegram
        // talk to the bot, so the first enable seeds them with entries that match
        // nothing. Only on the way on, and only over lists nobody has filled in.
        if (patch.cap_telegram === 1) {
          const current = await reg.config(env.MODEL);
          if (!current.cap_telegram) {
            for (const [key, value] of Object.entries(TELEGRAM_WHITELIST_DEFAULTS)) {
              const field = key as keyof typeof TELEGRAM_WHITELIST_DEFAULTS;
              if (patch[field] === undefined && current[field].trim() === "") {
                patch[field] = value;
              }
            }
          }
        }
        const config = await reg.setConfig(patch, env.MODEL);
        // Saving the token is the whole setup: the bot is pointed at this Worker here
        // rather than through a curl the user has to run by hand.
        const telegram = await syncWebhook(config, url.origin, env.TELEGRAM_API_BASE);
        return withCors(Response.json({ config: redact(config), ...(telegram ? { telegram } : {}) }));
      }
    }

    if (segments[0] === "api" && segments[1] === "mcp") {
      const handled = await handleMcp(request, env, url, segments);
      if (handled) return handled;
    }

    // "Why is the bot not answering?" — asked of Telegram itself.
    if (segments[0] === "api" && segments[1] === "telegram" && segments[2] === "status") {
      const config = await registry(env).config(env.MODEL);
      if (!config.telegram_bot_token) {
        return withCors(Response.json({ error: "no bot token saved" }, { status: 400 }));
      }
      const bot = new Telegram(config.telegram_bot_token, env.TELEGRAM_API_BASE);
      try {
        const [info, me] = await Promise.all([bot.webhookInfo(), bot.me()]);
        return withCors(
          Response.json({
            enabled: config.cap_telegram === 1,
            bot: me.username,
            expected: `${url.origin}/telegram/webhook`,
            webhook: info,
          })
        );
      } catch (err) {
        return withCors(
          Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
        );
      }
    }

    if (segments[0] === "api" && segments[1] === "sessions") {
      const reg = registry(env);
      const id = segments[2];

      if (request.method === "GET" && !id) {
        return withCors(Response.json({ sessions: await reg.list() }));
      }
      if (request.method === "POST" && !id) {
        const { id: wanted, title } = (await request.json().catch(() => ({}))) as {
          id?: string;
          title?: string;
        };
        const sessionId = wanted ?? crypto.randomUUID().slice(0, 8);
        // Record the object's hex id: it is the only way to attribute Cloudflare's
        // analytics back to a session. See docs/cloudflare-durable-object-costs.md.
        const objectId = env.SessionAgent.idFromName(sessionId).toString();
        return withCors(Response.json(await reg.create(sessionId, title ?? "New session", objectId)));
      }
      // Fork: a new session seeded with the first `count` messages of an existing one,
      // so a conversation can be branched without disturbing the original.
      if (request.method === "POST" && id && segments[3] === "fork") {
        const { count, title } = (await request.json().catch(() => ({}))) as {
          count?: number;
          title?: string;
        };
        const exported = await routeAgentRequest(
          new Request(
            `${url.origin}/agents/session-agent/${encodeURIComponent(id)}/export?count=${Number(count ?? 0)}`
          ),
          env
        );
        if (!exported?.ok) {
          return withCors(Response.json({ error: "could not read the source session" }, { status: 502 }));
        }
        const snapshot = await exported.text();

        const forkId = crypto.randomUUID().slice(0, 8);
        const objectId = env.SessionAgent.idFromName(forkId).toString();
        const source = (await reg.list()).find((s) => s.id === id);
        const row = await reg.create(
          forkId,
          title ?? `${source?.title ?? "Session"} (fork)`,
          objectId
        );
        const imported = await routeAgentRequest(
          new Request(`${url.origin}/agents/session-agent/${forkId}/import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: snapshot,
          }),
          env
        );
        if (!imported?.ok) {
          await reg.remove(forkId);
          return withCors(Response.json({ error: "could not seed the fork" }, { status: 502 }));
        }
        return withCors(Response.json(row));
      }

      // A session whose turns stopped completing, freed without losing what it holds.
      if (request.method === "POST" && id && segments[3] === "unstick") {
        const freed = await routeAgentRequest(
          new Request(`${url.origin}/agents/session-agent/${encodeURIComponent(id)}/unstick`, {
            method: "POST",
          }),
          env
        );
        if (!freed?.ok) {
          return withCors(Response.json({ error: "could not reach that session" }, { status: 502 }));
        }
        return withCors(Response.json(await freed.json()));
      }

      if (request.method === "PATCH" && id) {
        const { title } = (await request.json()) as { title: string };
        await reg.rename(id, title);
        return withCors(Response.json({ ok: true }));
      }
      if (request.method === "DELETE" && id) {
        await reg.remove(id);
        // Destroy the object itself, not just its rows: a Durable Object is billed
        // for the bytes it stores, so a cleared-but-living session still costs.
        await routeAgentRequest(
          new Request(`${url.origin}/agents/session-agent/${id}/destroy`, { method: "POST" }),
          env
        ).catch(() => {
          // `destroy()` aborts the isolate, which can surface as a broken response.
        });
        return withCors(Response.json({ ok: true }));
      }
    }

    // Keep the sidebar ordered by recency without the frontend having to say so.
    if (segments[0] === "agents" && segments[1] === "session-agent" && segments[2]) {
      const last = segments[3];
      if (last === "stream" || last === "chat") {
        await registry(env).touch(segments[2]);
      }
    }

    // Telegram posts here. The secret token is what makes the call trustworthy, so a
    // request without it is refused before anything is read.
    if (request.method === "POST" && segments[0] === "telegram" && segments[1] === "webhook") {
      return await handleWebhook(request, env, ctx);
    }

    const routed = await routeAgentRequest(request, env);
    if (routed) return withCors(routed);

    if (url.pathname === "/") {
      return withCors(
        Response.json({
          routes: {
            sessions: "GET|POST /api/sessions, PATCH|DELETE /api/sessions/:id",
            fork: "POST /api/sessions/:id/fork  { count }",
            unstick: "POST /api/sessions/:id/unstick",
            config: "GET|PATCH /api/config",
            mcp: "GET|POST /api/mcp, PATCH|DELETE /api/mcp/:id, POST /api/mcp/:id/{connect,disconnect,refresh}",
            stream: "POST /agents/session-agent/:id/stream  { message }  -> SSE",
            live: "GET /agents/session-agent/:id/live  -> SSE, or 204 when idle",
            chat: "POST /agents/session-agent/:id/chat  { message }",
            messages: "GET /agents/session-agent/:id/messages",
            files: "GET|POST /agents/session-agent/:id/files, GET|DELETE .../files/:fileId",
            tasks: "GET /agents/session-agent/:id/tasks, DELETE .../tasks/:taskId",
            metrics: "GET /agents/session-agent/:id/metrics",
            telegram: "POST /telegram/webhook",
          },
        })
      );
    }
    return withCors(Response.json({ error: "not found" }, { status: 404 }));
  },
};
