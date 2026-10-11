// Testes de integração: servidor real + PostgreSQL real (DATABASE_URL). Banco é limpo antes de rodar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import http from "node:http";
import crypto from "node:crypto";

// "Google" de teste: par RSA próprio publicado como JWKS local
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: otherKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks = http.createServer((_, res) => res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] })));
await new Promise((r) => jwks.listen(0, r));
process.env.GOOGLE_JWKS_URL = `http://127.0.0.1:${jwks.address().port}/certs`;
process.env.GOOGLE_CLIENT_ID = "nexo-test.apps.googleusercontent.com";
process.env.GOOGLE_ALLOWED_EMAILS = "julio@gmail.com, Ana@Acme.com";
process.env.SIGNUP_CODE = "fundador-123";
const { server, pool, migrate } = await import("../index.js");

function googleToken(claims = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "RS256", kid: "k1", typ: "JWT" });
  const body = b64({ iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, sub: "g-julio", email: "julio@gmail.com",
    email_verified: true, nonce: "n1", iat: now, exp: now + 3600, ...claims });
  return `${head}.${body}.${crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
}
let base;

before(async () => {
  await pool.query("drop table if exists nexo_records, nexo_team_members, nexo_teams, nexo_sessions, nexo_users cascade");
  await migrate();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); jwks.close(); await pool.end(); });

async function api(path, { token, body, method = body ? "POST" : "GET" } = {}) {
  const res = await fetch(base + path, {
    method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body)
  });
  return { status: res.status, ...(await res.json()) };
}
const contact = (id, updated_at, data = {}) => ({ kind: "contact", id, updated_at, data: { id, name: id, ...data } });

let ana, bia, team;

test("cadastro exige convite ou SIGNUP_CODE", async () => {
  assert.equal((await api("/auth/register", { body: { email: "x@x.com", password: "senha-forte-1" } })).status, 403);
  assert.equal((await api("/auth/register", { body: { email: "x@x.com", password: "senha-forte-1", signupCode: "errado" } })).status, 403);
  const r = await api("/auth/register", { body: { email: "Ana@Acme.com", password: "senha-forte-1", signupCode: "fundador-123" } });
  assert.equal(r.status, 200);
  assert.equal(r.user.email, "ana@acme.com");
  ana = r.token;
  assert.equal((await api("/auth/register", { body: { email: "ana@acme.com", password: "senha-forte-1", signupCode: "fundador-123" } })).status, 409);
});

test("login: senha errada é rejeitada, certa gera sessão", async () => {
  assert.equal((await api("/auth/login", { body: { email: "ana@acme.com", password: "errada-errada" } })).status, 401);
  const r = await api("/auth/login", { body: { email: "ana@acme.com", password: "senha-forte-1" } });
  assert.equal(r.status, 200);
  assert.equal((await api("/me", { token: r.token })).user.email, "ana@acme.com");
  assert.equal((await api("/me", { token: "invalido" })).status, 401);
});

test("criar equipe e entrar por convite no cadastro", async () => {
  team = await api("/teams", { token: ana, body: { name: "Vendas" } });
  assert.equal(team.role, "owner");
  const r = await api("/auth/register", { body: { email: "bia@acme.com", password: "senha-forte-2", inviteCode: team.invite_code } });
  assert.equal(r.team.id, team.id);
  bia = r.token;
  const t = await api(`/teams/${team.id}`, { token: bia });
  assert.deepEqual(t.members.map((m) => m.email), ["ana@acme.com", "bia@acme.com"]);
});

test("não membro não lê nem escreve", async () => {
  const r = await api("/auth/register", { body: { email: "eve@x.com", password: "senha-forte-3", signupCode: "fundador-123" } });
  assert.equal((await api(`/teams/${team.id}/records`, { token: r.token })).status, 403);
  assert.equal((await api(`/teams/${team.id}/records`, { token: r.token, body: { rows: [contact("a", 1)] } })).status, 403);
});

test("push/pull com cursor e last-write-wins", async () => {
  assert.equal((await api(`/teams/${team.id}/records`, { token: ana, body: { rows: [contact("ana-souza", 100, { stage: "Novo" })] } })).accepted, 1);
  let p = await api(`/teams/${team.id}/records`, { token: bia });
  assert.equal(p.rows[0].data.stage, "Novo");
  const cursor = p.cursor;

  assert.equal((await api(`/teams/${team.id}/records`, { token: bia, body: { rows: [contact("ana-souza", 200, { stage: "Reunião" })] } })).accepted, 1);
  // escrita mais antiga chegando atrasada é ignorada
  assert.equal((await api(`/teams/${team.id}/records`, { token: ana, body: { rows: [contact("ana-souza", 150, { stage: "Perdido" })] } })).accepted, 0);

  p = await api(`/teams/${team.id}/records?after=${cursor}`, { token: ana });
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].data.stage, "Reunião");
  assert.equal((await api(`/teams/${team.id}/records?after=${p.cursor}`, { token: ana })).rows.length, 0);
});

test("validação de registros", async () => {
  for (const bad of [{ kind: "x", id: "a", updated_at: 1, data: {} }, { kind: "contact", id: "", updated_at: 1, data: {} },
    { kind: "contact", id: "a", updated_at: -1, data: {} }, { kind: "contact", id: "a", updated_at: 1, data: [] }])
    assert.equal((await api(`/teams/${team.id}/records`, { token: ana, body: { rows: [bad] } })).status, 400);
});

test("pushes concorrentes: o pull incremental não perde nenhum registro", async () => {
  const start = (await api(`/teams/${team.id}/records`, { token: ana })).cursor;
  let cursor = start;
  const seen = new Set();
  const pulls = (async () => {
    for (let i = 0; i < 30; i++) {
      const p = await api(`/teams/${team.id}/records?after=${cursor}`, { token: ana });
      p.rows.forEach((r) => seen.add(r.id));
      cursor = p.cursor;
    }
  })();
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    api(`/teams/${team.id}/records`, { token: i % 2 ? ana : bia, body: { rows: Array.from({ length: 10 }, (_, j) => contact(`c${i}-${j}`, 1000 + i)) } })));
  await pulls;
  for (;;) {
    const p = await api(`/teams/${team.id}/records?after=${cursor}`, { token: ana });
    p.rows.forEach((r) => seen.add(r.id));
    cursor = p.cursor;
    if (!p.rows.length) break;
  }
  assert.equal(seen.size, 200);
});

test("só o dono troca o convite; o antigo para de funcionar", async () => {
  assert.equal((await api(`/teams/${team.id}/invite/rotate`, { token: bia, body: {} })).status, 403);
  const old = team.invite_code;
  const t = await api(`/teams/${team.id}/invite/rotate`, { token: ana, body: {} });
  assert.notEqual(t.invite_code, old);
  assert.equal((await api("/teams/join", { token: bia, body: { code: old } })).status, 404);
});

test("logout invalida a sessão", async () => {
  await api("/auth/logout", { token: bia, body: {} });
  assert.equal((await api("/me", { token: bia })).status, 401);
});

test("Google: config pública expõe só o client id", async () => {
  assert.deepEqual((await api("/auth/config")).google, { clientId: "nexo-test.apps.googleusercontent.com" });
});

test("Google: e-mail autorizado cria conta sem senha nem código", async () => {
  const r = await api("/auth/google", { body: { idToken: googleToken(), nonce: "n1" } });
  assert.equal(r.status, 200);
  assert.equal(r.user.email, "julio@gmail.com");
  assert.equal((await api("/me", { token: r.token })).user.email, "julio@gmail.com");
  // a conta Google não aceita login por senha
  assert.equal((await api("/auth/login", { body: { email: "julio@gmail.com", password: "qualquer-coisa" } })).status, 401);
});

test("Google: conta existente com senha é vinculada pelo e-mail", async () => {
  const r = await api("/auth/google", { body: { idToken: googleToken({ sub: "g-ana", email: "ana@acme.com" }), nonce: "n1" } });
  assert.equal(r.status, 200);
  const me = await api("/me", { token: r.token });
  assert.equal(me.teams[0]?.name, "Vendas"); // mesma conta de antes, com a equipe
  // outro "sub" do Google para o mesmo e-mail é recusado
  assert.equal((await api("/auth/google", { body: { idToken: googleToken({ sub: "g-intruso", email: "ana@acme.com" }), nonce: "n1" } })).status, 409);
});

test("Google: tokens adulterados, expirados, de outro app ou com nonce trocado são recusados", async () => {
  const cases = [
    googleToken({}, otherKey),                                   // assinatura de outra chave
    googleToken({ exp: Math.floor(Date.now() / 1000) - 3600 }),  // expirado
    googleToken({ aud: "outro-app.apps.googleusercontent.com" }), // outro aplicativo
    googleToken({ iss: "https://evil.example.com" }),            // outro emissor
    googleToken({ email_verified: false }),                     // e-mail não verificado
    "nao.e.jwt"
  ];
  for (const idToken of cases) assert.equal((await api("/auth/google", { body: { idToken, nonce: "n1" } })).status, 401);
  assert.equal((await api("/auth/google", { body: { idToken: googleToken(), nonce: "outro" } })).status, 401);
  // payload alterado depois de assinado
  const [h, , sig] = googleToken().split(".");
  const forged = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, sub: "x", email: "julio@gmail.com", email_verified: true, nonce: "n1", exp: 9e9 })).toString("base64url");
  assert.equal((await api("/auth/google", { body: { idToken: `${h}.${forged}.${sig}`, nonce: "n1" } })).status, 401);
});

test("Google: e-mail não autorizado precisa de convite, e com convite entra na equipe", async () => {
  const tok = googleToken({ sub: "g-caio", email: "caio@gmail.com" });
  assert.equal((await api("/auth/google", { body: { idToken: tok, nonce: "n1" } })).status, 403);
  const t = await api(`/teams/${team.id}`, { token: ana });
  const r = await api("/auth/google", { body: { idToken: tok, nonce: "n1", inviteCode: t.invite_code } });
  assert.equal(r.status, 200);
  assert.equal(r.team.id, team.id);
});

test("cofre pessoal: grava, lê, ignora versão antiga e é isolado por usuário", async () => {
  const me = { token: ana }; // sessão já existente (novos logins esbarrariam no limite por IP, que é o comportamento certo)
  assert.deepEqual(await api("/me/vault", { token: me.token }).then((r) => r.data), null);
  assert.equal((await api("/me/vault", { token: me.token, body: { data: { anthropicKey: "sk-1", tone: "direto" }, updated_at: 200 } })).saved, true);
  assert.equal((await api("/me/vault", { token: me.token, body: { data: { anthropicKey: "velha" }, updated_at: 100 } })).saved, false);
  const v = await api("/me/vault", { token: me.token });
  assert.equal(v.data.anthropicKey, "sk-1");
  assert.equal(v.updated_at, 200);
  const other = (await pool.query("insert into nexo_users(email) values ('zed@x.com') returning id")).rows[0];
  const otherTok = "tok-zed";
  await pool.query("insert into nexo_sessions(token_hash, user_id, expires_at) values (encode(sha256($1::bytea),'hex'), $2, now() + interval '1 day')", [otherTok, other.id]);
  assert.equal((await api("/me/vault", { token: otherTok })).data, null);
  assert.equal((await api("/me/vault", { body: { data: {}, updated_at: 1 } })).status, 401);
});
