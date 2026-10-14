const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

let user;
const originalFetch = global.fetch;
const previousEnv = { ...process.env };
Object.assign(process.env, {
  MICROSOFT_CLIENT_ID: "test-client", MICROSOFT_CLIENT_SECRET: "test-secret",
  MICROSOFT_REDIRECT_URI: "http://localhost:5000/api/microsoft-mail/callback",
  MICROSOFT_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), FRONTEND_URL: "http://localhost:5173",
  MICROSOFT_TENANT_ID: "common",
});

const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const matches = filter => user && Object.entries(filter).every(([key, expected]) => {
  const value = get(user, key);
  if (expected?.$ne !== undefined) return value !== expected.$ne;
  if (expected?.$gt) return value > expected.$gt;
  return value === expected;
});
const update = changes => {
  for (const [path, value] of Object.entries(changes.$set || {})) {
    const keys = path.split("."); let parent = user;
    for (const key of keys.slice(0, -1)) parent = parent[key] ||= {};
    parent[keys.at(-1)] = value;
  }
  for (const path of Object.keys(changes.$unset || {})) {
    const keys = path.split("."); const parent = keys.slice(0, -1).reduce((value, key) => value?.[key], user);
    if (parent) delete parent[keys.at(-1)];
  }
};
const query = value => ({ select: () => ({ lean: async () => value }) });
const model = {
  findById: id => query(user?._id === id ? structuredClone(user) : null),
  findOneAndUpdate: (filter, changes, options) => {
    if (!matches(filter)) return query(null);
    const before = structuredClone(user); update(changes);
    return query(options.new ? structuredClone(user) : before);
  },
  updateOne: async (filter, changes) => {
    if (!matches(filter)) return { matchedCount: 0 };
    update(changes); return { matchedCount: 1 };
  },
};
require.cache[require.resolve("../models/Users")] = { exports: model };
let smtpCalls = 0;
require.cache[require.resolve("../services/emailService")] = { exports: { sendMail: async () => { smtpCalls++; return { provider: "smtp" }; } } };
const service = require("../services/microsoftMailService");
const { sendUserMail, getUserEmailOptions } = require("../services/userEmailService");
const response = (status, data = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => data, headers: { get: () => "test-request" } });
const reset = () => { user = { _id: "user-1", email: "sender@outlook.com", name: "Sender", isDisabled: false, followUpEmailProvider: "smtp" }; };

test("Microsoft connection, token safety and follow-up sending", async t => {
  await t.test("configuration fails clearly when client registration is missing", () => {
    const saved = process.env.MICROSOFT_CLIENT_ID; delete process.env.MICROSOFT_CLIENT_ID;
    assert.throws(service.getConfig, { code: "MICROSOFT_SETUP_REQUIRED" }); process.env.MICROSOFT_CLIENT_ID = saved;
  });
  await t.test("encrypted tokens round-trip and reject tampering", () => {
    const sealed = service.seal("test-refresh-token");
    assert.ok(!sealed.includes("test-refresh-token")); assert.equal(service.unseal(sealed), "test-refresh-token");
    const parts = sealed.split("."); parts[1] = Buffer.alloc(16).toString("base64url");
    assert.throws(() => service.unseal(parts.join(".")));
  });
  await t.test("authorization uses PKCE, one-time state and the user's matching mailbox", async () => {
    reset();
    const url = new URL(await service.startConnection(user._id));
    const state = url.searchParams.get("state");
    const verifier = service.unseal(user.microsoftMail.pendingVerifier);
    assert.equal(url.searchParams.get("code_challenge"), crypto.createHash("sha256").update(verifier).digest("base64url"));
    assert.ok(url.searchParams.get("scope").includes("Mail.Send")); assert.ok(url.searchParams.get("scope").includes("offline_access"));
    assert.notEqual(user.microsoftMail.pendingState, state);
    global.fetch = async (address, options) => {
      if (address.includes("/token")) { assert.equal(options.body.get("code_verifier"), verifier); return response(200, { access_token: "test-access", refresh_token: "test-refresh" }); }
      return response(200, { mail: user.email });
    };
    await service.completeConnection({ state, code: "test-code" });
    assert.equal(user.followUpEmailProvider, "microsoft"); assert.equal(service.unseal(user.microsoftMail.refreshToken), "test-refresh");
    assert.equal(user.microsoftMail.pendingState, undefined);
    await assert.rejects(service.completeConnection({ state, code: "test-code" }), { code: "MICROSOFT_STATE_INVALID" });
  });
  await t.test("wrong Microsoft mailbox is rejected without saving its credentials", async () => {
    reset(); const url = new URL(await service.startConnection(user._id));
    global.fetch = async address => address.includes("/token") ? response(200, { access_token: "test-access", refresh_token: "test-refresh" }) : response(200, { mail: "different@outlook.com" });
    await assert.rejects(service.completeConnection({ state: url.searchParams.get("state"), code: "code" }), { code: "MICROSOFT_ACCOUNT_MISMATCH" });
    assert.equal(user.microsoftMail.refreshToken, undefined);
  });
  await t.test("expired state and cancelled consent cannot connect", async () => {
    reset(); let url = new URL(await service.startConnection(user._id)); user.microsoftMail.pendingExpiresAt = new Date(0);
    await assert.rejects(service.completeConnection({ state: url.searchParams.get("state"), code: "code" }), { code: "MICROSOFT_STATE_INVALID" });
    url = new URL(await service.startConnection(user._id));
    await assert.rejects(service.completeConnection({ state: url.searchParams.get("state"), error: "access_denied" }), { code: "MICROSOFT_CONSENT_DENIED" });
  });
  await t.test("Microsoft sender refreshes and sends through /me, never SMTP", async () => {
    reset(); user.followUpEmailProvider = "microsoft"; user.microsoftMail = { email: user.email, refreshToken: service.seal("old-refresh") };
    const calls = [];
    global.fetch = async (address, options) => {
      calls.push(address);
      if (address.includes("/token")) { assert.equal(options.body.get("refresh_token"), "old-refresh"); return response(200, { access_token: "fresh-access", refresh_token: "rotated-refresh" }); }
      assert.equal(options.headers.Authorization, "Bearer fresh-access");
      const payload = JSON.parse(options.body); assert.equal(payload.message.toRecipients[0].emailAddress.address, "candidate@example.com");
      assert.equal(payload.message.from, undefined); assert.equal(payload.message.body.contentType, "HTML"); return response(202);
    };
    const sent = await sendUserMail(user._id, { to: "candidate@example.com", subject: "Follow up", html: "<p>Hello</p>", from: "spoof@example.com" });
    assert.equal(sent.provider, "microsoft"); assert.equal(sent.accepted, true); assert.ok(calls[1].endsWith("/me/sendMail"));
    assert.equal(service.unseal(user.microsoftMail.refreshToken), "rotated-refresh"); assert.equal(smtpCalls, 0);
  });
  await t.test("missing, revoked and mismatched connections block sending", async () => {
    reset(); await assert.rejects(getUserEmailOptions(user._id), { code: "MICROSOFT_RECONNECT_REQUIRED" });
    user.followUpEmailProvider = "microsoft"; user.microsoftMail = { email: user.email, refreshToken: service.seal("refresh") };
    global.fetch = async () => response(400, { error: "invalid_grant" });
    await assert.rejects(sendUserMail(user._id, { to: "candidate@example.com" }), { code: "MICROSOFT_RECONNECT_REQUIRED" });
    assert.equal(user.microsoftMail.needsReconnect, true);
    user.microsoftMail.needsReconnect = false; user.email = "changed@example.com";
    await assert.rejects(getUserEmailOptions(user._id), { code: "MICROSOFT_RECONNECT_REQUIRED" });
  });
  await t.test("Gmail continues using the stored app password", async () => {
    reset(); user.email = "sender@gmail.com"; user.appPassword = "dummy-app-password";
    assert.equal((await sendUserMail(user._id, { to: "candidate@example.com" })).provider, "smtp"); assert.equal(smtpCalls, 1);
  });
});

test.after(() => { global.fetch = originalFetch; process.env = previousEnv; });
