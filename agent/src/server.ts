import { routeAgentRequest } from "agents";
import { MODELS, type Env } from "./agent";
import { Telegram, allowedBy, chatTitle, topicId, type TelegramUpdate } from "./telegram";
import {
  CAPABILITIES,
  SECRET_MASK,
  TELEGRAM_WHITELIST_DEFAULTS,
  type CapabilityField,
} from "./capabilities";
import {
  EMPTY_MCP_SERVER,
  agentIdOf,
  emailAllowed,
  normalizeEmails,
  sessionName,
  type AgentRow,
  type Config,
  type SessionRegistry,
} from "./registry";
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
export { AgentDirectory, SessionRegistry } from "./registry";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,PATCH,OPTIONS",
  "access-control-allow-headers": "content-type, x-api-secret, x-user-email",
};

/**
 * The two headers the frontend adds to every call it forwards.
 *
 * `x-api-secret` is what says the call came from the frontend at all — the Worker is
 * on the public internet, so without it anyone could ask for an agent's settings and
 * read its keys back out. `x-user-email` is the signed-in address the frontend got
 * from Clerk; the Worker trusts it *because* the secret vouched for the caller.
 */
const API_SECRET_HEADER = "x-api-secret";
const USER_EMAIL_HEADER = "x-user-email";

/** 404, not 403: an agent you were not given is one that does not exist. */
const notFound = () => withCors(Response.json({ error: "Agent not found." }, { status: 404 }));

/**
 * One agent's own store: its settings, its MCP servers, its memories, its sessions.
 *
 * Agents share nothing. Two agents are two Durable Objects, so one agent's bot token
 * and OpenRouter key are unreachable from the other, and a burst of traffic to one
 * queues on its object alone.
 */
function registry(env: Env, agentId: string) {
  return env.SessionRegistry.get(env.SessionRegistry.idFromName(agentId));
}

/** The index of which agents exist. A DO namespace cannot be enumerated. */
function directory(env: Env) {
  return env.AgentDirectory.get(env.AgentDirectory.idFromName("root"));
}

/**
 * Whether a request carries the frontend's shared secret.
 *
 * A deploy with no `API_SECRET` set is unguarded, which is what local development
 * wants: `wrangler dev` and `next dev` with no extra setup. Set the secret in
 * production and every route below the gate needs it.
 */
function trustedCaller(request: Request, env: Env): boolean {
  if (!env.API_SECRET) return true;
  return request.headers.get(API_SECRET_HEADER) === env.API_SECRET;
}

/**
 * The signed-in address on whose behalf this call is made, or "" when the deployment
 * is unguarded and nobody was named. An empty address never matches an access list,
 * so an agent's routes stay closed unless the check is explicitly skipped.
 */
function callerEmail(request: Request): string {
  return (request.headers.get(USER_EMAIL_HEADER) ?? "").trim().toLowerCase();
}

/**
 * Whether the caller may touch `agentId`.
 *
 * An unguarded deployment lets everything through — there is no identity to check
 * against, and pretending otherwise would only lock local development out of its own
 * agents. A guarded one requires the address to be on the agent's list.
 */
async function mayUseAgent(request: Request, env: Env, agentId: string): Promise<boolean> {
  if (!env.API_SECRET) return true;
  const email = callerEmail(request);
  if (!email) return false;
  const agent = await directory(env).get(agentId);
  return !!agent && emailAllowed(agent.allowed_emails, email);
}

type Registry = DurableObjectStub<SessionRegistry>;

/** Agent ids appear in session names, so they may not contain the separator. */
const AGENT_ID = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

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
 * Secrets that belong to no capability. The OpenRouter key is what every model call
 * is billed to, so it belongs to the agent itself rather than to any one thing the
 * agent can do — but it follows the same contract as a capability's credentials:
 * masked on the way out, and the mask on the way back in means "leave it alone".
 *
 * They are listed separately because `redact` and `validateConfig` walk
 * `CAPABILITY_FIELDS`, and a settings column reachable through neither would go to
 * the browser in the clear.
 */
const CORE_SECRETS = ["openrouter_api_key"] as const satisfies readonly (keyof Config)[];

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

  for (const key of CORE_SECRETS) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== "string") throw new Error(`${key} must be a string`);
    if (value === SECRET_MASK) continue;
    patch[key] = value.trim().slice(0, 1000);
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
  for (const key of CORE_SECRETS) {
    safe[key] = String(config[key] ?? "") ? SECRET_MASK : "";
  }
  for (const field of CAPABILITY_FIELDS) {
    if (!field.secret) continue;
    (safe[field.key] as string) = String(config[field.key] ?? "") ? SECRET_MASK : "";
  }
  return safe;
}

/**
 * Ask OpenRouter whether a key works.
 *
 * Worth a round trip because the failure mode moved: a key used to be the operator's
 * Worker secret, and is now something a user pastes into a form. Without this the
 * first sign of a typo is a chat that answers nothing, with the 401 buried inside a
 * stream error. Best effort, like the webhook check — the save already happened.
 */
async function checkOpenrouterKey(
  key: string
): Promise<{ ok: boolean; error?: string; label?: string }> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "OpenRouter rejected that key." };
    }
    if (!res.ok) return { ok: false, error: `OpenRouter answered ${res.status}.` };
    const json = (await res.json()) as { data?: { label?: string } };
    return { ok: true, label: json.data?.label ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Point the bot at this Worker, or unhook it when the capability is switched off.
 * Best effort: a bad token is reported back to the settings page, not thrown, because
 * the rest of the save has already happened.
 */
async function syncWebhook(
  config: Config,
  origin: string,
  agentId: string,
  api?: string
): Promise<{ ok: boolean; error?: string } | undefined> {
  if (!config.telegram_bot_token) return undefined;
  const bot = new Telegram(config.telegram_bot_token, api);
  try {
    if (config.cap_telegram) {
      // One route per agent: the update has to reach the right bot's settings, and
      // the token it is checked against is the one on that agent's row.
      await bot.setWebhook(
        `${origin}/telegram/webhook/${agentId}`,
        await webhookSecret(config.telegram_bot_token)
      );
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
  reg: Registry,
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
  reg: Registry,
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
 * only thing that reads them, and it clears them once the tokens are in. The state
 * is prefixed with the agent id, because the callback has nothing else to go on.
 */
async function startMcpOauth(
  reg: Registry,
  agentId: string,
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
  // The redirect URI is registered with the provider and cannot vary per agent, so
  // the callback is one route for all of them — and the state is the only thing that
  // comes back. It carries the agent so the callback knows whose registry to open.
  const state = `${agentId}.${randomToken(16)}`;
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
  const state = url.searchParams.get("state") ?? "";
  const agentId = state.split(".")[0] ?? "";
  if (!agentId) return new Response("unknown or expired authorization state", { status: 400 });
  const reg = registry(env, agentId);
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

/**
 * Everything under `/api/agents/:agentId/mcp`. `rest` is what follows `mcp`, so
 * `rest[0]` is a server id and `rest[1]` an action on it. Returns undefined when the
 * path is not one of these.
 *
 * Servers belong to one agent: they live in that agent's registry, and nothing here
 * can reach another agent's.
 */
async function handleMcp(
  request: Request,
  env: Env,
  url: URL,
  agentId: string,
  rest: string[]
): Promise<Response | undefined> {
  const reg = registry(env, agentId);
  const id = rest[0];
  const action = rest[1];

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

  if (id && action === "connect" && request.method === "POST") {
    const row = await reg.mcpServer(id);
    if (!row) return withCors(Response.json({ error: "no such server" }, { status: 404 }));
    const { return_to } = (await request.json().catch(() => ({}))) as { return_to?: string };
    try {
      const authorizeUrl = await startMcpOauth(reg, agentId, row, url.origin, return_to ?? "");
      return withCors(Response.json({ authorize_url: authorizeUrl }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await reg.updateMcpServer(id, { last_error: message });
      return withCors(Response.json({ error: message }, { status: 502 }));
    }
  }

  // Forget the tokens without forgetting the server: the URL and name stay put, so
  // reconnecting is one click rather than a re-entry.
  if (id && action === "disconnect" && request.method === "POST") {
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

  if (id && action === "refresh" && request.method === "POST") {
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


/* ----------------------------------------------------------------- agents -- */

/**
 * Delete an agent and everything it owns: its sessions and their files first, then
 * the settings, MCP servers and memories in its registry, then the name itself.
 *
 * The bot is unhooked before any of that. Its webhook points at a route that is
 * about to stop resolving, and a webhook Telegram keeps retrying against a 404 is
 * how a deleted agent goes on costing requests.
 */
async function deleteAgent(env: Env, origin: string, agentId: string): Promise<void> {
  const reg = registry(env, agentId);

  const config = await reg.config(env.MODEL);
  if (config.telegram_bot_token) {
    try {
      await new Telegram(config.telegram_bot_token, env.TELEGRAM_API_BASE).deleteWebhook();
    } catch {
      // A dead token cannot be unhooked, and it cannot receive anything either.
    }
  }

  for (const session of await reg.list()) {
    await routeAgentRequest(
      new Request(`${origin}/agents/session-agent/${encodeURIComponent(session.id)}/destroy`, {
        method: "POST",
      }),
      env
    ).catch(() => {
      // `destroy()` aborts the isolate, which can surface as a broken response.
    });
  }

  await reg.wipe();
  await directory(env).remove(agentId);
}

/** Everything under `/api/agents`. Undefined when the path is not one of these. */
async function handleAgents(
  request: Request,
  env: Env,
  url: URL,
  segments: string[]
): Promise<Response | undefined> {
  const dir = directory(env);
  const agentId = segments[2];

  if (!agentId) {
    if (request.method === "GET") {
      // A guarded deployment lists only what the caller may open; an unguarded one
      // has no identity to filter on and lists everything.
      const email = env.API_SECRET ? callerEmail(request) : undefined;
      return withCors(Response.json({ agents: await dir.list(email) }));
    }
    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        openrouter_api_key?: string;
        allowed_emails?: string | string[];
      };
      const key = (body.openrouter_api_key ?? "").trim().slice(0, 1000);

      // The creator is always on the list. Creating an agent you cannot open is
      // never what anyone meant, and an agent whose list is empty is unreachable
      // by anyone at all — there is no way back into it.
      const caller = callerEmail(request);
      const allowed = normalizeEmails([
        ...(caller ? [caller] : []),
        ...(Array.isArray(body.allowed_emails)
          ? body.allowed_emails
          : (body.allowed_emails ?? "").split(/[\n,;]/)),
      ]);
      if (env.API_SECRET && !allowed) {
        return withCors(Response.json({ error: "sign in to create an agent" }, { status: 401 }));
      }

      // The key is checked before the agent exists, not after. A typo would
      // otherwise leave a half-built agent behind that answers nothing, and the
      // person who made it already moved on to the chat page.
      const openrouter = key ? await checkOpenrouterKey(key) : undefined;
      if (openrouter && !openrouter.ok) {
        return withCors(Response.json({ error: openrouter.error }, { status: 400 }));
      }

      const row = await dir.create(
        AGENT_ID(),
        (body.name ?? "").trim().slice(0, 60) || "New agent",
        allowed
      );
      // Seed the settings row so the agent has a model — and its key — the moment
      // it exists, which is what lets it answer without a trip through Settings.
      await registry(env, row.id).setConfig(key ? { openrouter_api_key: key } : {}, env.MODEL);
      return withCors(Response.json({ ...row, ...(openrouter ? { openrouter } : {}) }));
    }
    return undefined;
  }

  const agent: AgentRow | undefined = await dir.get(agentId);
  if (!agent) return notFound();
  // Everything below belongs to one agent, so one check covers all of it: settings,
  // capabilities, MCP servers, sessions. Someone not on the list is told the agent
  // does not exist rather than that they may not have it.
  if (env.API_SECRET && !emailAllowed(agent.allowed_emails, callerEmail(request))) {
    return notFound();
  }

  const section = segments[3];

  if (!section) {
    if (request.method === "GET") return withCors(Response.json(agent));
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        allowed_emails?: string | string[];
      };
      let next = agent;

      if (body.name !== undefined) {
        const cleaned = body.name.trim().slice(0, 60);
        if (!cleaned) {
          return withCors(Response.json({ error: "name is required" }, { status: 400 }));
        }
        await dir.rename(agentId, cleaned);
        next = { ...next, name: cleaned };
      }

      if (body.allowed_emails !== undefined) {
        // The editor stays on the list. Removing yourself would hand the agent to
        // the remaining addresses and lock you out of the page that could undo it —
        // and emptying the list entirely would strand the agent for everyone.
        const caller = callerEmail(request);
        const allowed = normalizeEmails([
          ...(caller ? [caller] : []),
          ...(Array.isArray(body.allowed_emails)
            ? body.allowed_emails
            : body.allowed_emails.split(/[\n,;]/)),
        ]);
        if (!allowed) {
          return withCors(
            Response.json({ error: "at least one email is required" }, { status: 400 })
          );
        }
        await dir.setAllowedEmails(agentId, allowed);
        next = { ...next, allowed_emails: allowed };
      }

      return withCors(Response.json(next));
    }
    if (request.method === "DELETE") {
      await deleteAgent(env, url.origin, agentId);
      return withCors(Response.json({ ok: true }));
    }
    return undefined;
  }

  const reg = registry(env, agentId);

  if (section === "config") {
    if (request.method === "GET") {
      return withCors(
        Response.json({
          agent,
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
      const telegram = await syncWebhook(config, url.origin, agentId, env.TELEGRAM_API_BASE);
      // Only a key that was just pasted is checked; the mask never reaches here.
      const openrouter = patch.openrouter_api_key
        ? await checkOpenrouterKey(patch.openrouter_api_key)
        : undefined;
      return withCors(
        Response.json({
          config: redact(config),
          ...(telegram ? { telegram } : {}),
          ...(openrouter ? { openrouter } : {}),
        })
      );
    }
    return undefined;
  }

  if (section === "mcp") {
    return await handleMcp(request, env, url, agentId, segments.slice(4));
  }

  if (section === "sessions") {
    if (request.method === "GET") {
      return withCors(Response.json({ sessions: await reg.list() }));
    }
    if (request.method === "POST") {
      const { title } = (await request.json().catch(() => ({}))) as { title?: string };
      // The agent is part of the name, so one namespace of session objects can hold
      // every agent's sessions without two of them ever being the same object.
      const sessionId = sessionName(agentId, crypto.randomUUID().slice(0, 8));
      // Record the object's hex id: it is the only way to attribute Cloudflare's
      // analytics back to a session. See docs/cloudflare-durable-object-costs.md.
      const objectId = env.SessionAgent.idFromName(sessionId).toString();
      await dir.touch(agentId);
      return withCors(
        Response.json(await reg.create(sessionId, title ?? "New session", objectId))
      );
    }
    return undefined;
  }

  // "Why is the bot not answering?" — asked of Telegram itself.
  if (section === "telegram" && segments[4] === "status" && request.method === "GET") {
    const config = await reg.config(env.MODEL);
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
          expected: `${url.origin}/telegram/webhook/${agentId}`,
          webhook: info,
        })
      );
    } catch (err) {
      return withCors(
        Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
      );
    }
  }

  return undefined;
}

/* --------------------------------------------------------------- sessions -- */

/**
 * Everything under `/api/sessions/:id`. There is no agent in the path because the id
 * already carries it — a session name is `<agentId>~<local>` — so a session is
 * reachable by name alone, and the registry it is read from can only be its own.
 */
async function handleSession(
  request: Request,
  env: Env,
  url: URL,
  segments: string[]
): Promise<Response | undefined> {
  const id = segments[2];
  const agentId = agentIdOf(id);
  if (!agentId) return withCors(Response.json({ error: "not found" }, { status: 404 }));
  const reg = registry(env, agentId);

  // Fork: a new session seeded with the first `count` messages of an existing one,
  // so a conversation can be branched without disturbing the original.
  if (request.method === "POST" && segments[3] === "fork") {
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

    // A fork stays with the agent it was forked from; it could not read another
    // agent's settings anyway.
    const forkId = sessionName(agentId, crypto.randomUUID().slice(0, 8));
    const objectId = env.SessionAgent.idFromName(forkId).toString();
    const source = await reg.get(id);
    const row = await reg.create(forkId, title ?? `${source?.title ?? "Session"} (fork)`, objectId);
    const imported = await routeAgentRequest(
      new Request(`${url.origin}/agents/session-agent/${encodeURIComponent(forkId)}/import`, {
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
  if (request.method === "POST" && segments[3] === "unstick") {
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

  if (request.method === "PATCH") {
    const { title } = (await request.json()) as { title: string };
    await reg.rename(id, title);
    return withCors(Response.json({ ok: true }));
  }

  if (request.method === "DELETE") {
    await reg.remove(id);
    // Destroy the object itself, not just its rows: a Durable Object is billed
    // for the bytes it stores, so a cleared-but-living session still costs.
    await routeAgentRequest(
      new Request(`${url.origin}/agents/session-agent/${encodeURIComponent(id)}/destroy`, {
        method: "POST",
      }),
      env
    ).catch(() => {
      // `destroy()` aborts the isolate, which can surface as a broken response.
    });
    return withCors(Response.json({ ok: true }));
  }

  return undefined;
}

/* --------------------------------------------------------------- telegram -- */

/**
 * One Telegram update, for one agent. The chat is resolved to that agent's session —
 * created on first contact — and the message is handed to the session's own object,
 * which answers in the chat itself. Telegram retries anything that is not a fast 200,
 * so the turn runs after the response rather than under it.
 *
 * Every agent is a different bot with a different token, so each has its own route
 * and its own secret. The same chat talking to two agents gets two sessions.
 */
async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  agentId: string
): Promise<Response> {
  const reg = registry(env, agentId);
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
  const sessionId = existing?.id ?? (await reg.freeChatSessionId(agentId, chatId, threadId));
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
    new Request(`${url.origin}/agents/session-agent/${encodeURIComponent(sessionId)}/telegram`, {
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

    // The provider's redirect. One fixed path for every agent, because the redirect
    // URI is registered with the provider and cannot carry an agent id — so it is
    // matched before anything else under /api/mcp, and the agent comes out of the
    // OAuth state instead.
    if (segments[0] === "api" && segments[1] === "mcp" && segments[2] === "oauth" && segments[3] === "callback") {
      return await handleOauthCallback(url, env);
    }

    // Everything past this point is the app's own API, and the app is the only thing
    // meant to call it. Telegram's webhook and the MCP OAuth redirect are the two
    // exceptions, and both are matched before it: Telegram proves itself with the
    // per-bot secret it echoes back, and the redirect arrives from the provider's
    // browser, carrying a state token instead of a header.
    if (
      (segments[0] === "api" || segments[0] === "agents") &&
      !trustedCaller(request, env)
    ) {
      return withCors(Response.json({ error: "unauthorized" }, { status: 401 }));
    }

    // A session id names its agent, so the same access list guards the session
    // routes — the transcript, the files and the live stream included.
    if (
      (segments[0] === "agents" && segments[1] === "session-agent" && segments[2]) ||
      (segments[0] === "api" && segments[1] === "sessions" && segments[2])
    ) {
      const sessionId = decodeURIComponent(segments[2]);
      const owner = agentIdOf(sessionId);
      if (!owner || !(await mayUseAgent(request, env, owner))) return notFound();
    }

    // An agent and everything that belongs to it: settings, MCP servers, sessions.
    if (segments[0] === "api" && segments[1] === "agents") {
      const handled = await handleAgents(request, env, url, segments);
      if (handled) return handled;
    }

    // A session by name. The name says which agent owns it.
    if (segments[0] === "api" && segments[1] === "sessions" && segments[2]) {
      const handled = await handleSession(request, env, url, segments);
      if (handled) return handled;
    }

    // Keep the sidebar ordered by recency without the frontend having to say so.
    if (segments[0] === "agents" && segments[1] === "session-agent" && segments[2]) {
      const last = segments[3];
      if (last === "stream" || last === "chat") {
        const sessionId = decodeURIComponent(segments[2]);
        const agentId = agentIdOf(sessionId);
        if (agentId) {
          ctx.waitUntil(
            (async () => {
              await registry(env, agentId).touch(sessionId);
              await directory(env).touch(agentId);
            })()
          );
        }
      }
    }

    // Telegram posts here, on the route the agent's own bot was pointed at. The
    // secret token is what makes the call trustworthy, so a request without it is
    // refused before anything is read.
    if (
      request.method === "POST" &&
      segments[0] === "telegram" &&
      segments[1] === "webhook" &&
      segments[2]
    ) {
      return await handleWebhook(request, env, ctx, segments[2]);
    }

    const routed = await routeAgentRequest(request, env);
    if (routed) return withCors(routed);

    if (url.pathname === "/") {
      return withCors(
        Response.json({
          routes: {
            agents: "GET|POST /api/agents, GET|PATCH|DELETE /api/agents/:agentId",
            config: "GET|PATCH /api/agents/:agentId/config",
            mcp: "GET|POST /api/agents/:agentId/mcp, PATCH|DELETE .../mcp/:id, POST .../mcp/:id/{connect,disconnect,refresh}",
            sessions: "GET|POST /api/agents/:agentId/sessions",
            session: "PATCH|DELETE /api/sessions/:sessionId",
            fork: "POST /api/sessions/:sessionId/fork  { count }",
            unstick: "POST /api/sessions/:sessionId/unstick",
            stream: "POST /agents/session-agent/:sessionId/stream  { message }  -> SSE",
            live: "GET /agents/session-agent/:sessionId/live  -> SSE, or 204 when idle",
            chat: "POST /agents/session-agent/:sessionId/chat  { message }",
            messages: "GET /agents/session-agent/:sessionId/messages",
            files: "GET|POST /agents/session-agent/:sessionId/files, GET|DELETE .../files/:fileId",
            tasks: "GET /agents/session-agent/:sessionId/tasks, DELETE .../tasks/:taskId",
            metrics: "GET /agents/session-agent/:sessionId/metrics",
            telegram: "POST /telegram/webhook/:agentId",
          },
          note: "A session id is `<agentId>~<local>`; every /agents/session-agent route takes that whole id.",
        })
      );
    }
    return withCors(Response.json({ error: "not found" }, { status: 404 }));
  },
};
