import { routeAgentRequest } from "agents";
import { modelCatalog, type Env, type ModelOption } from "./agent";
import { Telegram, allowedBy, chatTitle, topicId, type TelegramUpdate } from "./telegram";
import {
  CAPABILITIES,
  CAPABILITY_BY_ID,
  SECRET_MASK,
  TELEGRAM_WHITELIST_DEFAULTS,
  type Capability,
  type CapabilityField,
  type CapabilityId,
} from "./capabilities";
import {
  EMPTY_MCP_SERVER,
  agentIdOf,
  emailAllowed,
  normalizeEmails,
  splitEmails,
  sessionName,
  type AccessRow,
  MAX_PAGE,
  SESSION_PAGE,
  type AgentRow,
  DEFAULT_META,
  DEFAULT_AGENT_LIMIT,
  type Config,
  type McpCatalogEntry,
  type MetaCapability,
  type MetaMcpServer,
  type MetaSettings,
  type ModelChoice,
  type MetaTunableKey,
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
import { clerkEmail } from "./clerk";

export { SessionAgent } from "./agent";
export { AgentDirectory, SessionRegistry } from "./registry";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,PATCH,OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-api-secret, x-user-email",
};

/**
 * The headers a call can carry, and the two ways to be somebody here.
 *
 * `authorization` is the ordinary one: a Clerk session token, whose signature the
 * Worker verifies against Clerk's published keys. The address comes out of the
 * verified claims, so it is one Clerk vouched for rather than one the caller typed.
 * This is the only identity a normal user of the app ever has.
 *
 * `x-api-secret` + `x-user-email` is the other one, and it is a back door on purpose.
 * Present the deployment's `API_SECRET` and the Worker takes the address beside it at
 * face value — any address, with no sign-in and no proof — and treats the caller as
 * that person for the whole request. It exists so a holder of the secret can act as
 * anyone, which is a feature here rather than an accident. It is also why `API_SECRET`
 * is not an origin check but a master key: whoever has it has every identity in the
 * deployment. Leave it unset and the door is not there at all.
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
 * Whether a request carries the deployment's shared secret.
 *
 * An unset `API_SECRET` is false, never true. A missing secret closes the back door;
 * it does not prop it open. This is the one place that distinction is made, and
 * having it backwards would hand every identity in the deployment to anyone at all.
 */
function trustedCaller(request: Request, env: Env): boolean {
  if (!env.API_SECRET) return false;
  return request.headers.get(API_SECRET_HEADER) === env.API_SECRET;
}

/**
 * What a deployment has to have been given before it is allowed to answer anything.
 *
 * `CLERK_ISSUER` is the one that matters. It is what lets the Worker verify a session
 * token, and a verified token is how every ordinary caller here becomes somebody.
 * Without it no signature can be checked, so no normal user can be identified at all,
 * and the only remaining way in is the `API_SECRET` back door — a deployment where
 * the sole working identity is the impersonation one. Worth refusing to start over.
 *
 * `API_SECRET` is deliberately *not* required. It is the back door, not the gate, and
 * a deployment without one simply has no back door — which is the safe direction to
 * fail in.
 *
 * Checked per request rather than at module load on purpose: a `throw` in the global
 * scope of a Worker surfaces as an opaque 1101, and the point of this gate is to say
 * exactly what is missing.
 */
function unconfigured(env: Env): string[] {
  const missing: string[] = [];
  if (!env.CLERK_ISSUER) missing.push("CLERK_ISSUER");
  return missing;
}

/**
 * The signed-in address on whose behalf this call is made, or "" when nobody was
 * named. An empty address never matches an access list, so an agent's routes stay
 * closed unless the check is explicitly skipped.
 *
 * The Clerk token wins when there is one. Its signature was checked against Clerk's
 * own keys, so nothing between the browser and here could have changed the address in
 * it, and `clerkEmail` caches the result for the token's short life so this costs a
 * map lookup rather than a public-key operation on the calls that follow.
 *
 * `x-user-email` is the fallback, and it is only ever reached when there is no
 * verified token to prefer. It is trusted on the strength of `API_SECRET` alone —
 * see the note on the headers above for what that means and why it stays.
 */
async function callerEmail(request: Request, env: Env): Promise<string> {
  const verified = await clerkEmail(request, env);
  if (verified) return verified;
  // The back door, and it opens for nobody without the secret. `trustedCaller` is
  // false when `API_SECRET` is unset, so a deployment that never configured one has
  // no second way in rather than an unguarded one.
  if (!trustedCaller(request, env)) return "";
  return (request.headers.get(USER_EMAIL_HEADER) ?? "").trim().toLowerCase();
}

/**
 * The agent's access list and admin, from the agent's own object.
 *
 * **The registry is authoritative for every access decision, always.** The directory
 * keeps a copy of the same list, but only as an index — it is what makes "the agents
 * this address may open" one query on the home page — and it never decides whether a
 * request is allowed. The two cannot be written in one transaction, because no
 * transaction spans two Durable Objects, so one of them has to be the truth and the
 * other has to be allowed to lag.
 *
 * Reading it here rather than from the directory is the entire point of the split:
 * this check runs on every message, every stream, every file, and `SessionRegistry`
 * is one object per agent, while the directory is one object for the deployment.
 *
 * Returns undefined when there is no such agent.
 *
 * The directory is still touched in one case: an agent created before access lived
 * in the registry has nothing there yet, and its list has to come from somewhere the
 * first time. That is a one-off per agent — `seedAccess` writes it down — so it costs
 * the directory one read per agent ever, not one per message.
 */
async function agentAccess(
  env: Env,
  agentId: string,
  known?: AgentRow
): Promise<AccessRow | undefined> {
  const reg = registry(env, agentId);
  const access = await reg.access();
  if (access.seeded) return access;
  // Unseeded is not "nobody is allowed" — it is "nobody has asked yet". Reading it as
  // an empty list would turn this deployment into a lockout for every agent that
  // already exists, so the answer comes from the directory once and is then adopted.
  const row = known ?? (await directory(env).get(agentId));
  if (!row) return undefined;
  return await reg.seedAccess(row.allowed_emails, row.admin_email);
}

/**
 * Whether the caller may *use* `agentId`: its chats, its files, its settings.
 *
 * The address has to be on the agent's list. Membership, and only membership: the
 * admin is deliberately not consulted, so an admin who never put their own address on
 * the list administers an agent they cannot open, which is the ordinary case now that
 * the two are separate.
 */
async function mayUseAgent(request: Request, env: Env, agentId: string): Promise<boolean> {
  const email = await callerEmail(request, env);
  if (!email) return false;
  const access = await agentAccess(env, agentId);
  return !!access && emailAllowed(access.allowed_emails, email);
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

/**
 * An OpenRouter model id: `vendor/model`, with the suffixes OpenRouter uses for
 * variants (`:free`, `:nitro`). Deliberately a shape check and not a catalogue —
 * the catalogue is OpenRouter's, it changes weekly, and meta settings exist so a
 * deployment can name a model this Worker has never heard of.
 */
const MODEL_ID = /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i;

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
    // Not checked against the Worker's own list any more: meta settings may name any
    // OpenRouter id, so the shape is what can be checked here. Which ids this agent
    // may actually be switched to is enforced where the meta document is readable.
    if (typeof body.model !== "string" || !MODEL_ID.test(body.model.trim())) {
      throw new Error(`not an OpenRouter model id: ${String(body.model)}`);
    }
    patch.model = body.model.trim();
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

  /**
   * Whether this call may change *which* servers the agent has.
   *
   * Adding one, repointing one, or removing one is the list itself, and whether the
   * agent's own pages may touch that is a meta setting. `?meta=1` is the dialog that
   * owns the setting saying so — the same bypass a locked config column gets on the
   * meta route, and for the same reason: everyone who reaches either is already on
   * the agent's access list, so this is about which page is asking, not about who.
   *
   * Using a server it already has is never refused: switching one off, choosing which
   * of its tools it may call, approving or dropping its OAuth.
   */
  const manages = async () =>
    url.searchParams.get("meta") === "1" || (await reg.meta()).mcp.user_servers;

  /** The fields of an MCP server that are the list rather than the use of it. */
  const LIST_FIELDS = ["name", "url", "auth", "headers"] as const;

  const refused = withCors(
    Response.json(
      { error: "This agent's MCP servers are managed for you." },
      { status: 403 }
    )
  );

  if (request.method === "GET" && !id) {
    const servers = await reg.mcpServers();
    const { mcp } = await reg.meta();
    return withCors(
      Response.json({
        servers: servers.map(mcpView),
        /** Shown on the page, because a provider may ask for it when registering by hand. */
        redirect_uri: redirectUri(url.origin),
        // The two admin settings the list itself has to draw: which providers the
        // strip offers, and whether the page may change the list at all. They come
        // back here rather than being read off `/meta`, which is the admin's route
        // and answers nobody else.
        templates: mcp.templates,
        // Templates provisioned from outside this deployment. They replace the
        // built-in strip rather than filtering it — see `MetaSettings.mcp.catalog`.
        catalog: mcp.catalog,
        user_servers: mcp.user_servers,
      })
    );
  }

  if (request.method === "POST" && !id) {
    if (!(await manages())) return refused;
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
    if (LIST_FIELDS.some((key) => patch[key] !== undefined) && !(await manages())) {
      return refused;
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
    if (!(await manages())) return refused;
    await reg.removeMcpServer(id);
    return withCors(Response.json({ ok: true }));
  }

  return undefined;
}


/* ---------------------------------------------------------- meta settings -- */

/** The tuning settings a meta default may be given for. */
const META_TUNABLES = [
  "model",
  "system_prompt",
  "temperature",
  "max_tokens",
  "reasoning_effort",
  "context_messages",
  "openrouter_api_key",
] as const satisfies readonly MetaTunableKey[];

/**
 * What a lock may name: a tuning column, or a capability. Locking a capability locks
 * its switch and every field it declares, because half a locked capability — a switch
 * nobody may flip over credentials anybody may rewrite — is not a useful thing.
 */
const LOCKABLE = new Set<string>([
  ...META_TUNABLES,
  ...CAPABILITIES.map((c) => c.id),
]);

/**
 * What the settings page may offer as models.
 *
 * The agent's own list wins where it has one, and the deployment's catalogue is what
 * an empty list means. A chosen model keeps its catalogue label when it has one, and
 * is shown as the id it is otherwise — but the vision flag is always the one chosen
 * beside it, because that is the answer somebody actually gave for this agent.
 */
function modelOptions(chosen: ModelChoice[], catalog: ModelOption[]): ModelOption[] {
  if (!chosen.length) return catalog;
  return chosen.map(({ id, vision }) => ({
    id,
    label: catalog.find((m) => m.id === id)?.label ?? id,
    vision,
  }));
}

/**
 * The capabilities as this agent sees them: a fixed-choice field whose options were
 * widened in meta settings offers those instead. The label of a known choice is kept,
 * so a familiar model does not become a bare id just because the list was extended.
 */
function capabilitiesFor(meta: MetaSettings): Capability[] {
  const widened = Object.entries(meta.field_options).filter(([, v]) => v.length > 0);
  if (!widened.length) return CAPABILITIES;
  const options = new Map(widened);
  return CAPABILITIES.map((capability) => {
    if (!capability.fields.some((f) => options.has(String(f.key)))) return capability;
    return {
      ...capability,
      fields: capability.fields.map((field) => {
        const values = options.get(String(field.key));
        if (!values) return field;
        return {
          ...field,
          options: values.map((value) => ({
            value,
            label: field.options?.find((o) => o.value === value)?.label ?? value,
          })),
        };
      }),
    };
  });
}

/** The config columns a lock covers. A capability's lock covers its whole section. */
function lockedColumns(locked: string[]): Set<string> {
  const columns = new Set<string>();
  for (const key of locked) {
    const capability = CAPABILITY_BY_ID.get(key as CapabilityId);
    if (capability) {
      columns.add(String(capability.flag));
      for (const field of capability.fields) columns.add(String(field.key));
    } else {
      columns.add(key);
    }
  }
  return columns;
}

/** Config columns a capability owns: its switch, plus every field it declares. */
const CAPABILITY_FIELD_KEYS = new Set<string>(CAPABILITY_FIELDS.map((f) => String(f.key)));

/**
 * Meta settings as they may be stored: a whole document, checked the same way a
 * config PATCH is. Defaults go through `validateConfig`, so a default can never be a
 * value the settings page itself would refuse — and the apply below can write them
 * straight in.
 */
function validateMeta(
  body: Partial<MetaSettings>,
  previous: MetaSettings,
  { creation }: { creation: boolean }
): MetaSettings {
  const meta: MetaSettings = {
    models: [],
    defaults: {},
    locked: [],
    capabilities: {},
    field_options: {},
    mcp: {
      templates: [],
      catalog: [],
      servers: [],
      user_servers: DEFAULT_META.mcp.user_servers,
    },
  };

  if (body.models !== undefined) {
    if (!Array.isArray(body.models)) throw new Error("models must be an array");
    const seen = new Set<string>();
    for (const entry of body.models) {
      // Bare ids are still accepted: that is what the list held before each model
      // carried a vision flag, and a stale tab may still be sending them.
      const id = (typeof entry === "string" ? entry : String(entry?.id ?? "")).trim();
      if (id === "") continue;
      if (!MODEL_ID.test(id)) throw new Error(`not an OpenRouter model id: ${id}`);
      if (seen.has(id)) continue;
      seen.add(id);
      const vision = typeof entry === "string" || entry.vision === undefined ? true : !!entry.vision;
      meta.models.push({ id, vision });
    }
  }

  if (body.field_options !== undefined) {
    if (typeof body.field_options !== "object" || body.field_options === null) {
      throw new Error("field_options must be an object");
    }
    for (const [key, values] of Object.entries(body.field_options)) {
      const field = CAPABILITY_FIELDS.find((f) => String(f.key) === key);
      // Only a field that is a fixed choice has choices to widen.
      if (!field?.options) throw new Error(`not a choice field: ${key}`);
      if (!Array.isArray(values)) throw new Error(`${key} options must be an array`);
      const cleaned = values
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v !== "");
      for (const value of cleaned) {
        if (!MODEL_ID.test(value)) throw new Error(`not an OpenRouter model id: ${value}`);
      }
      meta.field_options[key] = [...new Set(cleaned)];
    }
  }

  if (body.defaults !== undefined) {
    if (typeof body.defaults !== "object" || body.defaults === null) {
      throw new Error("defaults must be an object");
    }
    // Only the tuning keys: a capability's default lives under its capability.
    const wanted: Partial<Config> = {};
    for (const key of META_TUNABLES) {
      const value = body.defaults[key];
      if (value === undefined) continue;
      // A secret reads back masked, so the mask on the way in means "keep the one
      // already stored" — the same contract the config route uses.
      if (value === SECRET_MASK) {
        const kept = previous.defaults[key];
        if (kept !== undefined) (wanted[key] as unknown) = kept;
        continue;
      }
      (wanted[key] as unknown) = value;
    }
    meta.defaults = validateConfig(wanted) as MetaSettings["defaults"];
  }

  if (body.locked !== undefined) {
    if (!Array.isArray(body.locked)) throw new Error("locked must be an array");
    const keys = body.locked.filter((k): k is string => typeof k === "string");
    for (const key of keys) {
      if (!LOCKABLE.has(key)) throw new Error(`cannot lock: ${key}`);
    }
    meta.locked = [...new Set(keys)];
  }

  if (body.capabilities !== undefined) {
    if (typeof body.capabilities !== "object" || body.capabilities === null) {
      throw new Error("capabilities must be an object");
    }
    for (const [id, entry] of Object.entries(body.capabilities)) {
      const capability = CAPABILITY_BY_ID.get(id as CapabilityId);
      if (!capability) throw new Error(`unknown capability: ${id}`);
      if (!entry || typeof entry !== "object") continue;
      const kept: MetaCapability = {};
      if (entry.enabled !== undefined) kept.enabled = !!entry.enabled;
      if (entry.fields && typeof entry.fields === "object") {
        const fields: Record<string, string> = {};
        for (const [key, value] of Object.entries(entry.fields)) {
          if (!CAPABILITY_FIELD_KEYS.has(key)) throw new Error(`unknown field: ${key}`);
          if (typeof value !== "string") throw new Error(`${key} must be a string`);
          const field = CAPABILITY_FIELDS.find((f) => String(f.key) === key);
          // A stored secret reads back masked, so the mask means "leave it alone".
          if (field?.secret && value === SECRET_MASK) {
            const kept = previous.capabilities[id]?.fields?.[key];
            if (kept !== undefined) fields[key] = kept;
            continue;
          }
          fields[key] = value.slice(0, 8000);
        }
        kept.fields = fields;
      }
      meta.capabilities[id] = kept;
    }
  }

  if (body.mcp !== undefined) {
    if (typeof body.mcp !== "object" || body.mcp === null) throw new Error("mcp must be an object");
    if (body.mcp.templates !== undefined) {
      if (!Array.isArray(body.mcp.templates)) throw new Error("mcp.templates must be an array");
      meta.mcp.templates = [
        ...new Set(body.mcp.templates.filter((t): t is string => typeof t === "string")),
      ];
    }
    if (body.mcp.catalog !== undefined) {
      if (!Array.isArray(body.mcp.catalog)) throw new Error("mcp.catalog must be an array");
      meta.mcp.catalog = body.mcp.catalog.map((entry) => validateCatalogEntry(entry));
    }
    if (body.mcp.user_servers !== undefined) {
      meta.mcp.user_servers = !!body.mcp.user_servers;
    }
    if (body.mcp.servers !== undefined) {
      if (!Array.isArray(body.mcp.servers)) throw new Error("mcp.servers must be an array");
      meta.mcp.servers = body.mcp.servers.map((server) => {
        const checked = validateMcpBody({ ...server } as Record<string, unknown>);
        if (!checked.name || !checked.url) throw new Error("each MCP server needs a name and URL");
        return {
          name: checked.name,
          url: checked.url,
          auth: (checked.auth ?? "none") as MetaMcpServer["auth"],
          headers: parseHeaders(checked.headers ?? ""),
        };
      });
    }
  }

  // `defaults`, `capabilities` and `mcp.servers` are what the agent was *created*
  // with: seed values, written into its config and its server list the moment it
  // existed. Once it does exist there is nothing left for them to seed — the dialog
  // edits the agent's own settings and its own servers directly from then on — so
  // they are kept as the record of how it started rather than rewritten.
  if (!creation) {
    meta.defaults = previous.defaults;
    meta.mcp.servers = previous.mcp.servers;
    meta.capabilities = previous.capabilities;
  }

  return meta;
}

/**
 * One provisioned template, checked before it is stored.
 *
 * Every field is rendered on a page the agent's own owner opens, so a bad entry is a
 * broken tile rather than a bad request — hence the refusal here rather than a filter.
 * `url` is parsed because the tile turns it into a server; `auth` is checked against
 * the three this Worker can actually connect with.
 */
function validateCatalogEntry(entry: unknown): McpCatalogEntry {
  if (typeof entry !== "object" || entry === null) throw new Error("each MCP template must be an object");
  const raw = entry as Record<string, unknown>;
  const text = (key: string): string => {
    const value = raw[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`each MCP template needs a ${key}`);
    return value.trim();
  };
  const url = text("url");
  try {
    new URL(url);
  } catch {
    throw new Error(`MCP template ${text("id")} has an invalid URL`);
  }
  const auth = raw.auth ?? "none";
  if (auth !== "none" && auth !== "headers" && auth !== "oauth") {
    throw new Error("an MCP template's auth must be none, headers or oauth");
  }
  const optional = (key: string): string | undefined => {
    const value = raw[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  return {
    id: text("id"),
    name: text("name"),
    url,
    auth,
    letter: optional("letter"),
    color: optional("color"),
  };
}

/** Meta settings as the browser may see them: every secret becomes a mask. */
function redactMeta(meta: MetaSettings): MetaSettings {
  const defaults = { ...meta.defaults };
  for (const key of CORE_SECRETS) {
    if (defaults[key] !== undefined) (defaults[key] as string) = SECRET_MASK;
  }
  const capabilities: MetaSettings["capabilities"] = {};
  for (const [id, entry] of Object.entries(meta.capabilities)) {
    const fields: Record<string, string> = { ...(entry.fields ?? {}) };
    for (const field of CAPABILITY_FIELDS) {
      const key = String(field.key);
      if (field.secret && fields[key] !== undefined) fields[key] = SECRET_MASK;
    }
    capabilities[id] = { ...entry, ...(entry.fields ? { fields } : {}) };
  }
  return { ...meta, defaults, capabilities };
}

/**
 * Write the defaults into the agent: its tuning, its capability switches and their
 * fields, and any MCP server it is supposed to have.
 *
 * Deliberately explicit rather than automatic. The defaults are what a fresh agent
 * *should* look like, and an agent that has been tuned by hand should not have that
 * work undone every time the dialog is saved — so applying them is its own action.
 *
 * A server whose name is already taken is left exactly as it is: it may be connected,
 * and reseeding it would throw away tokens to no purpose.
 */
async function applyMeta(
  reg: Registry,
  meta: MetaSettings,
  env: Env,
  origin: string,
  agentId: string
): Promise<{ config: Config; added: string[] }> {
  const patch: Partial<Config> = { ...meta.defaults };

  for (const [id, entry] of Object.entries(meta.capabilities)) {
    const capability = CAPABILITY_BY_ID.get(id as CapabilityId);
    if (!capability) continue;
    if (entry.enabled !== undefined) (patch[capability.flag] as number) = entry.enabled ? 1 : 0;
    for (const [key, value] of Object.entries(entry.fields ?? {})) {
      (patch[key as keyof Config] as string) = value;
    }
  }

  const config = await reg.setConfig(validateConfig(patch), env.MODEL);

  const existing = await reg.mcpServers();
  const taken = new Set(existing.map((s) => s.name.toLowerCase()));
  const added: string[] = [];
  for (const wanted of meta.mcp.servers) {
    if (taken.has(wanted.name.toLowerCase())) continue;
    const row: McpServerRow = {
      ...EMPTY_MCP_SERVER,
      id: crypto.randomUUID().slice(0, 8),
      created_at: Date.now(),
      name: wanted.name,
      url: wanted.url,
      auth: wanted.auth,
      headers: JSON.stringify(wanted.headers ?? {}),
    };
    await reg.addMcpServer(row);
    // OAuth has nothing to read until somebody approves it; the rest can list now.
    if (row.auth !== "oauth") await syncMcpTools(reg, row);
    added.push(row.name);
  }

  // The switches just moved, and Telegram's is the one that has an outside effect.
  await syncWebhook(config, origin, agentId, env.TELEGRAM_API_BASE);

  return { config, added };
}

/* ----------------------------------------------------------------- agents -- */

/**
 * Delete an agent and everything it owns: the name first, so nothing can be admitted
 * to it while the rest is going away, then its sessions and their files, then the
 * settings, MCP servers, memories and access list in its registry.
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

  // The index goes before the storage, which is the one place the order is the other
  // way round from a membership edit — and for the same reason. `wipe()` leaves the
  // registry unseeded, and an unseeded registry asks the directory; so wiping first
  // would let a request arriving mid-teardown read the directory row that is still
  // there and seed the access list straight back into the object being torn down.
  // Removing the name first closes both doors at once: the gate finds no agent to
  // seed from, and every control-plane route 404s from here on.
  await directory(env).remove(agentId);

  // Deleting an agent has to reach every session it owns, not just the newest page,
  // so this walks the cursor to the end of the list.
  for (let cursor = "", more = true; more; ) {
    const page = await reg.list(MAX_PAGE, cursor);
    cursor = page.cursor;
    more = page.has_more;
    for (const session of page.sessions) {
      await routeAgentRequest(
        new Request(`${origin}/agents/session-agent/${encodeURIComponent(session.id)}/destroy`, {
          method: "POST",
        }),
        env
      ).catch(() => {
        // `destroy()` aborts the isolate, which can surface as a broken response.
      });
    }
  }

  await reg.wipe();
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
      // Only what the caller may open. An address that names nobody filters to
      // nothing, which is the right answer for a call that proved no identity.
      const email = await callerEmail(request, env);
      // How many more this caller may administer, so the frontend can hide the
      // create button before the account hits the wall rather than after.
      const limit = email ? await dir.getAgentLimit(email) : 0;
      const owned = email ? await dir.countByAdmin(email) : 0;
      return withCors(
        Response.json({ agents: await dir.list(email), agent_limit: limit, agents_owned: owned })
      );
    }
    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        openrouter_api_key?: string;
        allowed_emails?: string | string[];
        /** The agent's defaults, chosen in the second step of the create dialog. */
        meta?: Partial<MetaSettings>;
      };
      // Checked before the agent exists, like the key: a rejected document should
      // leave nothing behind. Creation is the one time the model default and the
      // default MCP servers may be set, so this is the call that reads them.
      let meta: MetaSettings | undefined;
      if (body.meta) {
        try {
          meta = validateMeta(body.meta, DEFAULT_META, { creation: true });
        } catch (err) {
          return withCors(Response.json({ error: (err as Error).message }, { status: 400 }));
        }
      }
      // The key comes from the second step with the rest of the agent's settings.
      // Still read off the top-level field as well: it is the older shape of this
      // call, and nothing else about it changed.
      const key = (body.openrouter_api_key ?? meta?.defaults.openrouter_api_key ?? "")
        .trim()
        .slice(0, 1000);

      // The list is exactly what was asked for. The creator is not added to it: the
      // list is the whole answer to who may open this agent, and an address silently
      // appended to it is one the person who made the agent never agreed to. The
      // dialog puts their own address in the box for them, so leaving it out is a
      // deletion rather than an oversight.
      //
      // It may not be empty, though. An agent nobody is on is one nobody can reach,
      // including to delete it.
      // Too many addresses is refused rather than trimmed to fit: see `MAX_MEMBERS`.
      let allowed: string;
      try {
        allowed = normalizeEmails(
          Array.isArray(body.allowed_emails)
            ? body.allowed_emails
            : (body.allowed_emails ?? "").split(/[\n,;]/)
        );
      } catch (err) {
        return withCors(Response.json({ error: (err as Error).message }, { status: 400 }));
      }
      if (!allowed) {
        return withCors(
          Response.json({ error: "at least one email is required" }, { status: 400 })
        );
      }

      // The key is checked before the agent exists, not after. A typo would
      // otherwise leave a half-built agent behind that answers nothing, and the
      // person who made it already moved on to the chat page.
      const openrouter = key ? await checkOpenrouterKey(key) : undefined;
      if (openrouter && !openrouter.ok) {
        return withCors(Response.json({ error: openrouter.error }, { status: 400 }));
      }

      // Whoever makes the agent administers it, for good. They are not put on the
      // access list by that: administering an agent and using one are two different
      // things now, and the box above is the whole answer to the second.
      //
      // Resolved here rather than inside the directory so that both objects are told
      // the same thing. A call that named nobody falls back to the first address on
      // the list, so the agent is never left with no administrator at all.
      const newId = AGENT_ID();
      const admin = (await callerEmail(request, env)) || (splitEmails(allowed)[0] ?? "");

      // How many agents this account may administer — itself included, and every one
      // it sponsors for somebody else. `DEFAULT_AGENT_LIMIT` for everybody except the
      // business accounts the owner has raised through `/api/admin/business-account`.
      const limit = await dir.getAgentLimit(admin);
      const owned = await dir.countByAdmin(admin);
      if (owned >= limit) {
        return withCors(
          Response.json(
            {
              error: `this account may administer at most ${limit} agent${limit === 1 ? "" : "s"}`,
            },
            { status: 403 }
          )
        );
      }

      // The agent's own object first, the index second. The access list is only ever
      // decided by the registry, so writing it there is what brings the agent into
      // existence as far as every gate is concerned; the directory row is what makes
      // it findable. Fail between the two and there is an agent nobody can see and
      // nobody can open — an orphan, but not a leak.
      await registry(env, newId).setAccess({ allowed_emails: allowed, admin_email: admin });
      const row = await dir.create(
        newId,
        (body.name ?? "").trim().slice(0, 60) || "New agent",
        allowed,
        admin
      );
      // Seed the settings row so the agent has a model — and its key — the moment
      // it exists, which is what lets it answer without a trip through Settings.
      // Telegram is on from the start, so its whitelists are seeded here for the same
      // reason the first enable seeds them below: empty lists would let all of
      // Telegram talk to the bot the moment a token is pasted.
      const reg = registry(env, row.id);
      await reg.setConfig(
        { agent_name: row.name, ...TELEGRAM_WHITELIST_DEFAULTS },
        env.MODEL
      );
      // The defaults are applied straight away: an agent made through the dialog is
      // meant to open already looking the way the second step described it.
      if (meta) {
        await reg.setMeta(meta);
        await applyMeta(reg, meta, env, url.origin, row.id);
      }
      // Already written by `applyMeta` when it came from the settings step; this is
      // for the caller that still sends it at the top level.
      if (key) await reg.setConfig({ openrouter_api_key: key }, env.MODEL);
      return withCors(Response.json({ ...row, ...(openrouter ? { openrouter } : {}) }));
    }
    return undefined;
  }

  // The catalogues the create dialog's second step picks from, before there is an
  // agent to hang them off. Nothing here belongs to anyone, so nothing is checked
  // beyond the gate every /api route is already behind.
  if (agentId === "catalog" && request.method === "GET") {
    return withCors(Response.json({ models: modelCatalog(env), capabilities: CAPABILITIES }));
  }

  // The directory row is what the response bodies below are built from: the name and
  // the timestamps live only there. This is the control plane — opening a settings
  // page, not sending a message — so one directory read here is not the traffic this
  // split was made to remove.
  const row: AgentRow | undefined = await dir.get(agentId);
  if (!row) return notFound();

  // The decision, though, comes from the agent's own object. Passing the row in
  // spares a second directory read when this agent has still to be seeded.
  const access = await agentAccess(env, agentId, row);
  if (!access) return notFound();

  // What the caller is told about who may open this agent is the authority's answer,
  // not the index's. They agree except in the window after a membership change where
  // the directory write has yet to land, and showing the stale one there would have
  // the settings page contradict the gate.
  const agent: AgentRow = {
    ...row,
    allowed_emails: access.allowed_emails,
    admin_email: access.admin_email,
  };

  // The agent's own object. Declared up here because it is now the authority on
  // access as well as the store for everything the sections below read.
  const reg = registry(env, agentId);

  /**
   * The two ways to be allowed here, and they do not overlap.
   *
   * A *user* is on the access list: the agent's pages are theirs — its chats, its
   * settings, its capabilities, its MCP servers. An *admin* made the agent: the meta
   * document is theirs, and so is deleting it, and nothing else. Being admin does not
   * open the agent, so an admin who is not also on the list is turned away from
   * everything a user reaches, exactly like a stranger.
   *
   * Both are true at once when the admin put their own address on the list, which is
   * the ordinary case for an agent someone made for themselves.
   */
  const email = await callerEmail(request, env);
  const isUser = emailAllowed(access.allowed_emails, email);
  const isAdmin = !!email && access.admin_email === email;
  if (!isUser && !isAdmin) return notFound();

  const section = segments[3];

  if (!section) {
    // The row itself — name, access list, who administers it — is readable by both:
    // it is what the admin dialog puts in its header, and it says nothing an admin
    // does not already know about the agent they made.
    if (request.method === "GET") return withCors(Response.json(agent));
    if (request.method === "PATCH") {
      // Renaming the agent and editing its access list are settings-page edits, so
      // they belong to its users. An admin who is not one does not get them.
      if (!isUser) return notFound();
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
        // The settings row keeps its own copy: it is what the system prompt tells the
        // model it is called, and the session object never reads the directory.
        await registry(env, agentId).setConfig({ agent_name: cleaned }, env.MODEL);
        next = { ...next, name: cleaned };
      }

      if (body.allowed_emails !== undefined) {
        // The editor stays on the list. Removing yourself would hand the agent to
        // the remaining addresses and lock you out of the page that could undo it —
        // and emptying the list entirely would strand the agent for everyone.
        const caller = await callerEmail(request, env);
        let allowed: string;
        try {
          allowed = normalizeEmails([
            ...(caller ? [caller] : []),
            ...(Array.isArray(body.allowed_emails)
              ? body.allowed_emails
              : body.allowed_emails.split(/[\n,;]/)),
          ]);
        } catch (err) {
          return withCors(Response.json({ error: (err as Error).message }, { status: 400 }));
        }
        if (!allowed) {
          return withCors(
            Response.json({ error: "at least one email is required" }, { status: 400 })
          );
        }
        // The gate first, the index second, and never the other way round.
        //
        // These two writes cannot be made one transaction — they are two Durable
        // Objects — so one of them can land without the other, and the order decides
        // which way that failure falls. Registry first means a removed address loses
        // access immediately and, if the second write never lands, goes on seeing the
        // agent listed on the home page until the list is saved again: an agent that
        // 404s when opened, which is cosmetic. Directory first would mean the
        // opposite — struck off the index but still admitted by the gate — which is
        // somebody keeping access they were meant to lose.
        await reg.setAccess({ allowed_emails: allowed });
        await dir.setAllowedEmails(agentId, allowed);
        next = { ...next, allowed_emails: allowed };
      }

      return withCors(Response.json(next));
    }
    if (request.method === "DELETE") {
      // Deleting is the admin's, not the users'. The agent exists because they made
      // it, and somebody who was given access to use it should not be able to take
      // it away from everyone else who was.
      if (!isAdmin) return notFound();
      await deleteAgent(env, url.origin, agentId);
      return withCors(Response.json({ ok: true }));
    }
    return undefined;
  }

  // From here down is the agent itself: its settings, its capabilities, its sessions,
  // its bot. All of that is using the agent, so all of it is the users'. The two
  // sections an admin can reach — the meta document above, and the MCP list behind
  // `?meta=1` — say so for themselves.
  if (!isUser && section !== "meta" && section !== "mcp") return notFound();

  if (section === "config") {
    if (request.method === "GET") {
      // Meta settings decide which models this agent may be switched between, so the
      // filtering happens here rather than in the page: a model that is not offered
      // is one a PATCH from that page will never carry.
      const meta = await reg.meta();
      return withCors(
        Response.json({
          agent,
          config: redact(await reg.config(env.MODEL)),
          models: modelOptions(meta.models, modelCatalog(env)),
          capabilities: capabilitiesFor(meta),
          // What the agent's own pages may not show or change. They are decided in
          // the meta dialog, so a page that drew them would be offering an edit that
          // the PATCH below drops on the floor.
          locked: meta.locked,
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
      // A locked setting belongs to the meta dialog. Dropping it here rather than
      // refusing the whole PATCH keeps one stale tab from blocking every other
      // setting in the same save.
      const meta = await reg.meta();
      // Which ids this agent may be switched between is a meta setting, so it is
      // enforced here rather than in `validateConfig`, which cannot see the document.
      if (
        patch.model !== undefined &&
        meta.models.length &&
        !meta.models.some((m) => m.id === patch.model)
      ) {
        return withCors(
          Response.json({ error: `model not offered: ${patch.model}` }, { status: 400 })
        );
      }
      const locks = lockedColumns(meta.locked);
      for (const key of Object.keys(patch)) {
        if (locks.has(key)) delete patch[key as keyof Config];
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

  if (section === "meta") {
    // The admin document, and the admin's alone. It is what decides the agent's
    // defaults and which of them its users may touch, so a user who could edit it
    // could simply unlock everything that was locked away from them.
    if (!isAdmin) return notFound();
    if (request.method === "GET") {
      return withCors(
        Response.json({
          agent,
          meta: redactMeta(await reg.meta()),
          // The agent's own settings, which the dialog edits beside the locks. They
          // come from here rather than from `/config`, because that route belongs to
          // the agent's users and an admin need not be one.
          config: redact(await reg.config(env.MODEL)),
          // The catalogues the dialog picks from: it never keeps its own copy of
          // what models exist or what a capability's fields are.
          models: modelCatalog(env),
          capabilities: CAPABILITIES,
        })
      );
    }
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as Partial<MetaSettings> & {
        /**
         * The agent's own settings, edited in the same dialog. Meta settings are the
         * settings page plus the locks, so the two are saved together — and in this
         * order, so a model id added to the list above is already offered by the time
         * the setting that names it is written.
         */
        config?: Partial<Config>;
      };
      let meta: MetaSettings;
      try {
        meta = validateMeta(body, await reg.meta(), { creation: false });
      } catch (err) {
        return withCors(Response.json({ error: (err as Error).message }, { status: 400 }));
      }
      const saved = await reg.setMeta(meta);

      let config: Config | undefined;
      if (body.config) {
        let patch: Partial<Config>;
        try {
          patch = validateConfig(body.config);
        } catch (err) {
          return withCors(Response.json({ error: (err as Error).message }, { status: 400 }));
        }
        if (
          patch.model !== undefined &&
          saved.models.length &&
          !saved.models.some((m) => m.id === patch.model)
        ) {
          return withCors(
            Response.json({ error: `model not offered: ${patch.model}` }, { status: 400 })
          );
        }
        // Deliberately not filtered by `lockedColumns`: a lock says the agent's own
        // pages may not touch a setting, and this is the page that decides the lock.
        config = await reg.setConfig(patch, env.MODEL);
        await syncWebhook(config, url.origin, agentId, env.TELEGRAM_API_BASE);
      }

      return withCors(
        Response.json({
          meta: redactMeta(saved),
          ...(config ? { config: redact(config) } : {}),
        })
      );
    }
    if (request.method === "POST") {
      const applied = await applyMeta(reg, await reg.meta(), env, url.origin, agentId);
      return withCors(Response.json({ config: redact(applied.config), added: applied.added }));
    }
    return undefined;
  }

  if (section === "mcp") {
    // `?meta=1` is the server list inside the admin dialog, which is why an admin who
    // is not a user reaches it at all. Everything else about MCP — connecting a
    // server, approving its OAuth, choosing its tools — is using the agent.
    const fromMeta = url.searchParams.get("meta") === "1";
    if (!isUser && !(isAdmin && fromMeta)) return notFound();
    return await handleMcp(request, env, url, agentId, segments.slice(4));
  }

  if (section === "sessions") {
    if (request.method === "GET") {
      // Paged: the sidebar asks for a screenful and follows the cursor as it scrolls,
      // so an agent with thousands of sessions costs the same first load as a new one.
      const limit = Number(url.searchParams.get("limit") ?? SESSION_PAGE);
      const size = Number.isFinite(limit) ? limit : SESSION_PAGE;
      return withCors(
        Response.json(await reg.list(size, url.searchParams.get("cursor") ?? ""))
      );
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
    // Before anything else, including CORS: a Worker that cannot identify anyone
    // answers nothing at all. 503 rather than 500 — the deployment is not broken, it
    // is incomplete, and it starts working the moment the variable is set without
    // anything here changing.
    const missing = unconfigured(env);
    if (missing.length) {
      return withCors(
        Response.json(
          {
            error: `This Worker is not configured: ${missing.join(", ")} is not set, so no Clerk session token can be verified and no ordinary caller can be identified. Set it in \`vars\` in agent/wrangler.jsonc — it is the \`iss\` your Clerk tokens carry, e.g. https://<subdomain>.clerk.accounts.dev.`,
          },
          { status: 503 }
        )
      );
    }

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

    // The owner's own switch: raise an account's agent ceiling, which is what makes
    // it a business account — there is no separate flag, only a higher number. Gated
    // on `API_SECRET` alone, matched before the identity gate below, because the
    // deployment's owner is the one caller here with no Clerk session of their own.
    if (segments[0] === "api" && segments[1] === "admin" && segments[2] === "business-account") {
      if (!trustedCaller(request, env)) {
        return withCors(Response.json({ error: "unauthorized" }, { status: 401 }));
      }
      if (request.method !== "POST") {
        return withCors(Response.json({ error: "method not allowed" }, { status: 405 }));
      }
      const body = (await request.json().catch(() => ({}))) as {
        email?: string;
        agent_limit?: number;
      };
      const email = (body.email ?? "").trim().toLowerCase();
      const limit = Number(body.agent_limit);
      if (!email || !Number.isInteger(limit) || limit < 1) {
        return withCors(
          Response.json(
            { error: "email and a positive integer agent_limit are required" },
            { status: 400 }
          )
        );
      }
      await directory(env).setAgentLimit(email, limit);
      return withCors(Response.json({ email, agent_limit: limit }));
    }

    // A signed-in account asking the owner to raise its own ceiling. Anyone can file
    // one — approving it is what actually changes anything, and that stays behind
    // `API_SECRET` below.
    if (segments[0] === "api" && segments[1] === "business-requests" && !segments[2]) {
      if (request.method !== "POST") {
        return withCors(Response.json({ error: "method not allowed" }, { status: 405 }));
      }
      const email = await callerEmail(request, env);
      if (!email) {
        return withCors(Response.json({ error: "sign in required" }, { status: 401 }));
      }
      const body = (await request.json().catch(() => ({}))) as { increase?: number };
      const increase = Number(body.increase);
      if (!Number.isInteger(increase) || increase < 1) {
        return withCors(
          Response.json({ error: "a positive integer increase is required" }, { status: 400 })
        );
      }
      const row = await directory(env).fileBusinessRequest(email, increase);
      return withCors(Response.json(row));
    }

    // The owner's queue of open asks — who wants how much more, and what they have
    // now. Same gate as the routes above: this is the owner's own inbox, not
    // anything a caller's own identity could unlock.
    if (segments[0] === "api" && segments[1] === "admin" && segments[2] === "business-requests") {
      if (!trustedCaller(request, env)) {
        return withCors(Response.json({ error: "unauthorized" }, { status: 401 }));
      }
      const dir = directory(env);
      const id = segments[3];
      if (!id) {
        if (request.method !== "GET") {
          return withCors(Response.json({ error: "method not allowed" }, { status: 405 }));
        }
        return withCors(Response.json({ requests: await dir.listBusinessRequests() }));
      }
      if (segments[4] === "approve" && request.method === "POST") {
        const result = await dir.approveBusinessRequest(id);
        if (!result) {
          return withCors(Response.json({ error: "no such request" }, { status: 404 }));
        }
        return withCors(Response.json(result));
      }
      if (!segments[4] && request.method === "DELETE") {
        await dir.deleteBusinessRequest(id);
        return withCors(Response.json({ ok: true }));
      }
      return withCors(Response.json({ error: "method not allowed" }, { status: 405 }));
    }

    // The owner's own dashboard feed: deployment-wide counts plus a row per agent.
    // Same gate as the business-account route, and for the same reason — this is
    // usage data across every account, not any one caller's own.
    if (segments[0] === "api" && segments[1] === "admin" && segments[2] === "stats") {
      if (!trustedCaller(request, env)) {
        return withCors(Response.json({ error: "unauthorized" }, { status: 401 }));
      }
      const dir = directory(env);
      const agents = await dir.list();
      const limits = await dir.agentLimits();
      const per_agent = await Promise.all(
        agents.map(async (a) => ({
          id: a.id,
          name: a.name,
          admin_email: a.admin_email,
          members: splitEmails(a.allowed_emails).length,
          sessions: await registry(env, a.id).sessionCount(),
          agent_limit: limits[a.admin_email] ?? DEFAULT_AGENT_LIMIT,
          created_at: a.created_at,
          updated_at: a.updated_at,
        }))
      );
      return withCors(
        Response.json({
          agents: agents.length,
          users: await dir.distinctUsers(),
          business_accounts: await dir.businessAccounts(),
          sessions: per_agent.reduce((sum, a) => sum + a.sessions, 0),
          per_agent,
        })
      );
    }

    // Everything past this point has to be somebody. Not "came from the app" — that
    // was the old gate, and a shared secret is a poor answer to a question about
    // identity — but an address this Worker is willing to stand behind: one out of a
    // verified Clerk token, or one named beside the `API_SECRET` back door.
    //
    // Nothing below this line is reachable anonymously, and everything below it can
    // assume `callerEmail` is non-empty. The two exceptions are matched before it:
    // Telegram proves itself with the per-bot secret it echoes back, and the MCP
    // OAuth redirect arrives from the provider's browser carrying a state token
    // instead of a header.
    //
    // `clerkEmail` caches by token, so the verification this forces is paid once per
    // token rather than once per request, and the checks further down reuse it.
    if (
      (segments[0] === "api" || segments[0] === "agents") &&
      !(await callerEmail(request, env))
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
            meta: "GET|PATCH /api/agents/:agentId/meta, POST .../meta (apply defaults)",
            catalog: "GET /api/agents/catalog  -> models and capabilities",
            mcp: "GET|POST /api/agents/:agentId/mcp, PATCH|DELETE .../mcp/:id, POST .../mcp/:id/{connect,disconnect,refresh}",
            sessions: "GET|POST /api/agents/:agentId/sessions  (GET: ?limit&cursor)",
            session: "PATCH|DELETE /api/sessions/:sessionId",
            fork: "POST /api/sessions/:sessionId/fork  { count }",
            unstick: "POST /api/sessions/:sessionId/unstick",
            stream: "POST /agents/session-agent/:sessionId/stream  { message }  -> SSE",
            live: "GET /agents/session-agent/:sessionId/live  -> SSE, or 204 when idle",
            chat: "POST /agents/session-agent/:sessionId/chat  { message }",
            messages: "GET /agents/session-agent/:sessionId/messages  ?limit&before",
            files: "GET|POST /agents/session-agent/:sessionId/files, GET|DELETE .../files/:fileId",
            tasks: "GET /agents/session-agent/:sessionId/tasks, DELETE .../tasks/:taskId",
            metrics: "GET /agents/session-agent/:sessionId/metrics",
            telegram: "POST /telegram/webhook/:agentId",
            admin: "POST /api/admin/business-account { email, agent_limit }, GET /api/admin/stats  -> owner only, via API_SECRET",
            business_requests: "POST /api/business-requests { increase } -> signed-in caller; GET /api/admin/business-requests, POST .../:id/approve, DELETE .../:id -> owner only, via API_SECRET",
          },
          note: "A session id is `<agentId>~<local>`; every /agents/session-agent route takes that whole id.",
        })
      );
    }
    return withCors(Response.json({ error: "not found" }, { status: 404 }));
  },
};
