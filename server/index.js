// Nexo server: autenticação, equipes e sincronização last-write-wins sobre PostgreSQL.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import pg from "pg";

const cfg = {
  port: Number(process.env.PORT || 8787),
  databaseUrl: process.env.DATABASE_URL,
  signupCode: process.env.SIGNUP_CODE || "",          // permite criar conta sem convite (fundadores)
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  trustProxy: process.env.TRUST_PROXY === "1",
  // Login com Google: ID do cliente OAuth (Web) e e-mails que podem criar conta sem convite
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleAllowed: (process.env.GOOGLE_ALLOWED_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
  googleJwksUrl: process.env.GOOGLE_JWKS_URL || "https://www.googleapis.com/oauth2/v3/certs"
};
const LIMITS = { bodyBytes: 2_000_000, rowsPerPush: 500, rowBytes: 64_000, pullPage: 1000, idChars: 200 };

export const pool = new pg.Pool({ connectionString: cfg.databaseUrl });

// ---------- utilidades ----------
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");
const newInvite = () => crypto.randomBytes(9).toString("base64url");

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt:${salt.toString("base64")}:${crypto.scryptSync(pw, salt, 64).toString("base64")}`;
}
function verifyPassword(pw, stored) {
  if (!stored) return false; // conta criada só com Google
  const [, salt, hash] = stored.split(":");
  const expected = Buffer.from(hash, "base64");
  const got = crypto.scryptSync(pw, Buffer.from(salt, "base64"), expected.length);
  return crypto.timingSafeEqual(got, expected);
}

const isStr = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const normEmail = (e) => (isStr(e, 254) && /^[^\s@]+@[^\s@]+$/.test(e.trim()) ? e.trim().toLowerCase() : null);

// Limite simples de tentativas de login/cadastro por IP (memória do processo)
const attempts = new Map();
function rateLimit(key, max = 10, windowMs = 15 * 60_000) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, "Muitas tentativas. Tente novamente em alguns minutos.");
  list.push(now);
  attempts.set(key, list);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > LIMITS.bodyBytes) throw new HttpError(413, "Requisição grande demais.");
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "JSON inválido."); }
}

// ---------- Google ID token (RS256), verificado com as chaves públicas do Google ----------
let jwksCache = { at: 0, keys: [] };
async function googleKeys(kid) {
  if (Date.now() - jwksCache.at > 3600_000 || !jwksCache.keys.some((k) => k.kid === kid)) {
    const res = await fetch(cfg.googleJwksUrl);
    if (!res.ok) throw new HttpError(502, "Não foi possível obter as chaves do Google.");
    jwksCache = { at: Date.now(), keys: (await res.json()).keys || [] };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === kid);
  if (!jwk) throw new HttpError(401, "Token do Google com chave desconhecida.");
  return crypto.createPublicKey({ key: jwk, format: "jwk" });
}

export async function verifyGoogleIdToken(idToken, nonce) {
  if (!cfg.googleClientId) throw new HttpError(503, "Login com Google não configurado no servidor (GOOGLE_CLIENT_ID).");
  const parts = typeof idToken === "string" ? idToken.split(".") : [];
  if (parts.length !== 3) throw new HttpError(401, "Token do Google inválido.");
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url"));
  } catch { throw new HttpError(401, "Token do Google inválido."); }
  if (header.alg !== "RS256") throw new HttpError(401, "Algoritmo de token não aceito.");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), await googleKeys(header.kid), Buffer.from(parts[2], "base64url"));
  if (!ok) throw new HttpError(401, "Assinatura do token do Google inválida.");
  const now = Date.now() / 1000;
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) throw new HttpError(401, "Emissor do token inválido.");
  if (payload.aud !== cfg.googleClientId) throw new HttpError(401, "Token emitido para outro aplicativo.");
  if (!(payload.exp > now - 60) || (payload.iat && payload.iat > now + 300)) throw new HttpError(401, "Token do Google expirado. Tente de novo.");
  if (!nonce || payload.nonce !== nonce) throw new HttpError(401, "Token do Google não corresponde a este login.");
  if (payload.email_verified !== true || !normEmail(payload.email)) throw new HttpError(401, "E-mail do Google não verificado.");
  return { sub: String(payload.sub), email: normEmail(payload.email) };
}

const clientIp = (req) => (cfg.trustProxy && req.headers["x-forwarded-for"]?.split(",")[0].trim()) || req.socket.remoteAddress;

// ---------- sessão e permissão ----------
async function issueSession(db, userId) {
  const token = newToken();
  await db.query("insert into nexo_sessions(token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))",
    [sha256(token), userId, cfg.sessionDays]);
  return token;
}

async function authUser(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) throw new HttpError(401, "Faça login.");
  const { rows } = await pool.query(
    "select u.id, u.email from nexo_sessions s join nexo_users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()",
    [sha256(m[1])]);
  if (!rows[0]) throw new HttpError(401, "Sessão expirada. Faça login novamente.");
  return rows[0];
}

async function requireMember(teamId, userId) {
  if (!/^[0-9a-f-]{36}$/i.test(teamId)) throw new HttpError(404, "Equipe não encontrada.");
  const { rows } = await pool.query("select role from nexo_team_members where team_id = $1 and user_id = $2", [teamId, userId]);
  if (!rows[0]) throw new HttpError(403, "Você não faz parte desta equipe.");
  return rows[0].role;
}

const teamView = (t) => ({ id: t.id, name: t.name, invite_code: t.invite_code, role: t.role });

async function joinByCode(db, code, userId) {
  const { rows } = await db.query("select * from nexo_teams where invite_code = $1", [code]);
  if (!rows[0]) throw new HttpError(404, "Código de convite inválido.");
  await db.query("insert into nexo_team_members(team_id, user_id) values ($1, $2) on conflict do nothing", [rows[0].id, userId]);
  return { ...rows[0], role: "member" };
}

async function tx(fn) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    const out = await fn(db);
    await db.query("commit");
    return out;
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}

// ---------- rotas ----------
const routes = [
  ["GET", /^\/health$/, async () => {
    await pool.query("select 1");
    return { ok: true };
  }],

  // Cadastro exige convite de uma equipe ou o SIGNUP_CODE do servidor: estranhos não criam contas.
  ["POST", /^\/auth\/register$/, async (req) => {
    rateLimit(`auth:${clientIp(req)}`);
    const b = await readJson(req);
    const email = normEmail(b.email);
    if (!email) throw new HttpError(400, "E-mail inválido.");
    if (!isStr(b.password, 200) || b.password.length < 10) throw new HttpError(400, "A senha precisa ter pelo menos 10 caracteres.");
    const viaSignup = cfg.signupCode && isStr(b.signupCode, 200) && crypto.timingSafeEqual(Buffer.from(sha256(b.signupCode)), Buffer.from(sha256(cfg.signupCode)));
    if (!viaSignup && !isStr(b.inviteCode, 100)) throw new HttpError(403, "Cadastro exige um código de convite.");
    return tx(async (db) => {
      const { rows } = await db.query("insert into nexo_users(email, password_hash) values ($1, $2) on conflict (email) do nothing returning id, email", [email, hashPassword(b.password)]);
      if (!rows[0]) throw new HttpError(409, "Este e-mail já tem conta. Faça login.");
      const team = viaSignup ? null : await joinByCode(db, b.inviteCode, rows[0].id);
      return { token: await issueSession(db, rows[0].id), user: rows[0], team: team && teamView(team) };
    });
  }],

  ["POST", /^\/auth\/login$/, async (req) => {
    const b = await readJson(req);
    const email = normEmail(b.email);
    rateLimit(`auth:${clientIp(req)}`);
    rateLimit(`login:${email}`, 20, 60 * 60_000);
    const { rows } = await pool.query("select id, email, password_hash from nexo_users where email = $1", [email]);
    if (!rows[0] || !isStr(b.password, 200) || !verifyPassword(b.password, rows[0].password_hash)) throw new HttpError(401, "E-mail ou senha incorretos. Ainda não tem conta? Use a aba Criar conta.");
    return { token: await issueSession(pool, rows[0].id), user: { id: rows[0].id, email: rows[0].email } };
  }],

  ["GET", /^\/auth\/config$/, async () => ({ google: cfg.googleClientId ? { clientId: cfg.googleClientId } : null })],

  // Entrar com Google: conta existente (por sub ou e-mail) entra; nova conta só com e-mail autorizado ou convite
  ["POST", /^\/auth\/google$/, async (req) => {
    rateLimit(`auth:${clientIp(req)}`, 30);
    const b = await readJson(req);
    const g = await verifyGoogleIdToken(b.idToken, b.nonce);
    return tx(async (db) => {
      let { rows: [u] } = await db.query("select id, email, google_sub from nexo_users where google_sub = $1 or email = $2 order by (google_sub = $1) desc limit 1", [g.sub, g.email]);
      let team = null;
      if (!u) {
        const allowed = cfg.googleAllowed.includes(g.email);
        if (!allowed && !isStr(b.inviteCode, 100)) throw new HttpError(403, `A conta ${g.email} não está autorizada. Peça um código de convite ou inclua o e-mail em GOOGLE_ALLOWED_EMAILS no servidor.`);
        ({ rows: [u] } = await db.query("insert into nexo_users(email, google_sub) values ($1, $2) returning id, email, google_sub", [g.email, g.sub]));
        if (!allowed) team = await joinByCode(db, b.inviteCode.trim(), u.id);
      } else if (!u.google_sub) {
        await db.query("update nexo_users set google_sub = $2 where id = $1", [u.id, g.sub]);
      } else if (u.google_sub !== g.sub) {
        throw new HttpError(409, "Este e-mail já está vinculado a outra conta Google.");
      }
      if (!team && isStr(b.inviteCode, 100)) team = await joinByCode(db, b.inviteCode.trim(), u.id);
      return { token: await issueSession(db, u.id), user: { id: u.id, email: u.email }, team: team && teamView(team) };
    });
  }],

  ["POST", /^\/auth\/logout$/, async (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
    if (m) await pool.query("delete from nexo_sessions where token_hash = $1", [sha256(m[1])]);
    return { ok: true };
  }],

  ["GET", /^\/me$/, async (req) => {
    const u = await authUser(req);
    const { rows } = await pool.query(
      "select t.*, m.role from nexo_teams t join nexo_team_members m on m.team_id = t.id where m.user_id = $1 order by t.created_at", [u.id]);
    return { user: u, teams: rows.map(teamView) };
  }],

  // Cofre pessoal: só o próprio usuário lê/grava; last-write-wins por updated_at do cliente
  ["GET", /^\/me\/vault$/, async (req) => {
    const u = await authUser(req);
    const { rows: [r] } = await pool.query("select vault, vault_updated_at from nexo_users where id = $1", [u.id]);
    return { data: r?.vault || null, updated_at: r?.vault_updated_at ? Number(r.vault_updated_at) : 0 };
  }],
  ["POST", /^\/me\/vault$/, async (req) => {
    const u = await authUser(req);
    const b = await readJson(req);
    if (!b.data || typeof b.data !== "object" || Array.isArray(b.data) || !Number.isSafeInteger(b.updated_at)) throw new HttpError(400, "Cofre inválido.");
    if (JSON.stringify(b.data).length > 256_000) throw new HttpError(413, "Cofre grande demais.");
    const res = await pool.query(
      "update nexo_users set vault = $2, vault_updated_at = $3 where id = $1 and (vault_updated_at is null or vault_updated_at < $3)",
      [u.id, b.data, b.updated_at]);
    return { saved: res.rowCount === 1 };
  }],

  ["POST", /^\/teams$/, async (req) => {
    const u = await authUser(req);
    const { name } = await readJson(req);
    if (!isStr(name?.trim(), 100)) throw new HttpError(400, "Dê um nome à equipe.");
    return tx(async (db) => {
      const { rows } = await db.query("insert into nexo_teams(name, invite_code) values ($1, $2) returning *", [name.trim(), newInvite()]);
      await db.query("insert into nexo_team_members(team_id, user_id, role) values ($1, $2, 'owner')", [rows[0].id, u.id]);
      return teamView({ ...rows[0], role: "owner" });
    });
  }],

  ["POST", /^\/teams\/join$/, async (req) => {
    const u = await authUser(req);
    rateLimit(`join:${u.id}`, 10);
    const { code } = await readJson(req);
    if (!isStr(code, 100)) throw new HttpError(400, "Informe o código de convite.");
    return teamView(await joinByCode(pool, code.trim(), u.id));
  }],

  ["GET", /^\/teams\/([^/]+)$/, async (req, [teamId]) => {
    const u = await authUser(req);
    const role = await requireMember(teamId, u.id);
    const { rows: [t] } = await pool.query("select * from nexo_teams where id = $1", [teamId]);
    const { rows: members } = await pool.query(
      "select u.email, m.role, m.joined_at from nexo_team_members m join nexo_users u on u.id = m.user_id where m.team_id = $1 order by m.joined_at", [teamId]);
    return { ...teamView({ ...t, role }), members };
  }],

  // Gera um novo código de convite (o antigo deixa de funcionar). Só o dono.
  ["POST", /^\/teams\/([^/]+)\/invite\/rotate$/, async (req, [teamId]) => {
    const u = await authUser(req);
    if ((await requireMember(teamId, u.id)) !== "owner") throw new HttpError(403, "Só o dono da equipe pode trocar o convite.");
    const { rows } = await pool.query("update nexo_teams set invite_code = $2 where id = $1 returning *", [teamId, newInvite()]);
    return teamView({ ...rows[0], role: "owner" });
  }],

  ["GET", /^\/teams\/([^/]+)\/records$/, async (req, [teamId], url) => {
    const u = await authUser(req);
    await requireMember(teamId, u.id);
    const after = /^\d{1,18}$/.test(url.searchParams.get("after") || "") ? url.searchParams.get("after") : "0";
    const { rows } = await pool.query(
      "select kind, id, data, updated_at, seq from nexo_records where team_id = $1 and seq > $2 order by seq limit $3",
      [teamId, after, LIMITS.pullPage]);
    return {
      rows: rows.map((r) => ({ kind: r.kind, id: r.id, data: r.data, updated_at: Number(r.updated_at) })),
      cursor: rows.length ? String(rows.at(-1).seq) : after,
      more: rows.length === LIMITS.pullPage
    };
  }],

  ["POST", /^\/teams\/([^/]+)\/records$/, async (req, [teamId]) => {
    const u = await authUser(req);
    await requireMember(teamId, u.id);
    const { rows } = await readJson(req);
    if (!Array.isArray(rows) || rows.length > LIMITS.rowsPerPush) throw new HttpError(400, `Envie até ${LIMITS.rowsPerPush} registros por vez.`);
    for (const r of rows) {
      const ok = ["contact", "template"].includes(r?.kind) && isStr(r.id, LIMITS.idChars) && Number.isSafeInteger(r.updated_at) && r.updated_at > 0
        && r.data && typeof r.data === "object" && !Array.isArray(r.data) && JSON.stringify(r.data).length <= LIMITS.rowBytes;
      if (!ok) throw new HttpError(400, `Registro inválido: ${String(r?.kind)}:${String(r?.id).slice(0, 50)}`);
    }
    if (!rows.length) return { accepted: 0 };
    return tx(async (db) => {
      // Serializa escritas por equipe: seq passa a refletir a ordem de commit, e o pull nunca pula registros.
      await db.query("select pg_advisory_xact_lock(hashtext($1))", [teamId]);
      const res = await db.query(`
        insert into nexo_records (team_id, kind, id, data, updated_at, updated_by)
        select $1, r.kind, r.id, r.data, r.updated_at, $2
        from jsonb_to_recordset($3::jsonb) as r(kind text, id text, data jsonb, updated_at bigint)
        on conflict (team_id, kind, id) do update
          set data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by, seq = nextval('nexo_records_seq')
          where excluded.updated_at > nexo_records.updated_at`,
        [teamId, u.id, JSON.stringify(rows)]);
      return { accepted: res.rowCount };
    });
  }]
];

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (origin.startsWith("chrome-extension://")) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("vary", "origin");
  }
}

export const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  const url = new URL(req.url, "http://x");
  let status = 200, body;
  try {
    const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
    if (!route) throw new HttpError(404, "Rota não encontrada.");
    body = await route[2](req, route[1].exec(url.pathname).slice(1).map(decodeURIComponent), url);
  } catch (e) {
    status = e.status || 500;
    if (status === 500) console.error(e);
    body = { error: status === 500 ? "Erro interno." : e.message };
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
});

export async function migrate() {
  await pool.query(fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  await pool.query("delete from nexo_sessions where expires_at < now()");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!cfg.databaseUrl) { console.error("Defina DATABASE_URL."); process.exit(1); }
  await migrate();
  server.listen(cfg.port, () => console.log(`Nexo server ouvindo na porta ${cfg.port}`));
  const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
