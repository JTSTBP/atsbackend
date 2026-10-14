const crypto = require("crypto");
const User = require("../models/Users");

const SCOPES = "offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send";
const mailError = (code, message, status = 400) => Object.assign(new Error(message), { code, status, provider: "microsoft" });
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const isOutlookAddress = email => /@(outlook\.[a-z.]+|hotmail\.[a-z.]+|live\.[a-z.]+|msn\.com)$/i.test(email || "");

const getConfig = () => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  const frontend = process.env.FRONTEND_URL;
  const key = Buffer.from(process.env.MICROSOFT_TOKEN_ENCRYPTION_KEY || "", "base64");
  const tenant = process.env.MICROSOFT_TENANT_ID || "common";
  if (!clientId || !clientSecret || !redirectUri || !frontend || key.length !== 32 || !/^[a-zA-Z0-9-]+$/.test(tenant)) {
    throw mailError("MICROSOFT_SETUP_REQUIRED", "Microsoft email needs administrator setup before you can connect.", 503);
  }
  for (const value of [redirectUri, frontend]) {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
      throw mailError("MICROSOFT_SETUP_REQUIRED", "Microsoft email requires HTTPS outside localhost.", 503);
    }
  }
  return { clientId, clientSecret, redirectUri, frontendOrigin: new URL(frontend).origin, key, tenant };
};

const seal = value => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getConfig().key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
};

const unseal = value => {
  const [iv, tag, encrypted] = String(value || "").split(".").map(part => Buffer.from(part, "base64url"));
  const cipher = crypto.createDecipheriv("aes-256-gcm", getConfig().key, iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString("utf8");
};

const requestToken = async params => {
  const config = getConfig();
  const response = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope: SCOPES, ...params }),
  });
  const data = await response.json();
  if (["invalid_client", "unauthorized_client"].includes(data.error)) throw mailError("MICROSOFT_SETUP_REQUIRED", "Microsoft app credentials or permissions need administrator attention.", 503);
  if (!response.ok || !data.access_token) throw mailError("MICROSOFT_RECONNECT_REQUIRED", "Microsoft sign-in expired or was denied. Connect your Microsoft account again.");
  return data;
};

const startConnection = async userId => {
  const config = getConfig();
  const state = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const user = await User.findOneAndUpdate({ _id: userId, isDisabled: { $ne: true } }, { $set: {
    "microsoftMail.pendingState": hash(state), "microsoftMail.pendingVerifier": seal(verifier),
    "microsoftMail.pendingExpiresAt": new Date(Date.now() + 10 * 60 * 1000),
  } }, { new: true }).select("email").lean();
  if (!user) throw mailError("SENDER_UNAVAILABLE", "Your account is unavailable.");
  const query = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri,
    response_mode: "query", scope: SCOPES, state, prompt: "select_account", login_hint: user.email,
    code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  return `https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/authorize?${query}`;
};

const completeConnection = async ({ state, code, error }) => {
  if (typeof state !== "string" || !state || state.length > 512) throw mailError("MICROSOFT_STATE_INVALID", "Sign-in expired. Start again from your profile.");
  // Consume the short-lived state once, even on denied consent or a failed exchange.
  const user = await User.findOneAndUpdate({ "microsoftMail.pendingState": hash(state), "microsoftMail.pendingExpiresAt": { $gt: new Date() }, isDisabled: { $ne: true } }, {
    $unset: { "microsoftMail.pendingState": "", "microsoftMail.pendingVerifier": "", "microsoftMail.pendingExpiresAt": "" },
  }, { new: false }).select("email microsoftMail").lean();
  if (!user) throw mailError("MICROSOFT_STATE_INVALID", "Sign-in expired. Start again from your profile.");
  if (error || typeof code !== "string" || !code) throw mailError("MICROSOFT_CONSENT_DENIED", "Microsoft connection was cancelled or denied.");
  const tokens = await requestToken({ code, redirect_uri: getConfig().redirectUri, grant_type: "authorization_code", code_verifier: unseal(user.microsoftMail.pendingVerifier) });
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!response.ok) throw mailError("MICROSOFT_PROFILE_FAILED", "Unable to verify your Microsoft email address.");
  const profile = await response.json();
  const email = user.email.trim().toLowerCase();
  if (![profile.mail, profile.userPrincipalName].some(value => String(value || "").trim().toLowerCase() === email)) {
    throw mailError("MICROSOFT_ACCOUNT_MISMATCH", "Sign in with the Microsoft mailbox matching your ATS profile email.");
  }
  if (!tokens.refresh_token) throw mailError("MICROSOFT_CONSENT_REQUIRED", "Microsoft did not grant background email access. Please connect again.");
  const updated = await User.updateOne({ _id: user._id, email: user.email, isDisabled: { $ne: true } }, { $set: {
    followUpEmailProvider: "microsoft", "microsoftMail.email": email, "microsoftMail.refreshToken": seal(tokens.refresh_token),
    "microsoftMail.connectedAt": new Date(), "microsoftMail.needsReconnect": false,
  } });
  if (!updated.matchedCount) throw mailError("MICROSOFT_ACCOUNT_CHANGED", "Your profile changed. Please connect again.");
};

const assertMicrosoftConnection = user => {
  getConfig();
  if (!user.microsoftMail?.refreshToken || user.microsoftMail.needsReconnect || user.microsoftMail.email !== user.email?.trim().toLowerCase()) {
    throw mailError("MICROSOFT_RECONNECT_REQUIRED", "Connect your Microsoft email in your profile before sending follow-ups.");
  }
};

// Serialize refreshes per mailbox to avoid rotating the same refresh token concurrently.
const refreshes = new Map();
const getAccessToken = userId => {
  const id = String(userId?._id || userId);
  if (refreshes.has(id)) return refreshes.get(id);
  const promise = (async () => {
    const user = await User.findById(id).select("email isDisabled followUpEmailProvider microsoftMail").lean();
    if (!user || user.isDisabled || user.followUpEmailProvider !== "microsoft") throw mailError("SENDER_UNAVAILABLE", "Microsoft sending is not enabled for this user.");
    assertMicrosoftConnection(user);
    const previous = user.microsoftMail.refreshToken;
    let tokens;
    try { tokens = await requestToken({ grant_type: "refresh_token", refresh_token: unseal(previous) }); }
    catch (error) {
      if (error.code === "MICROSOFT_RECONNECT_REQUIRED") await User.updateOne({ _id: id, "microsoftMail.refreshToken": previous }, { $set: { "microsoftMail.needsReconnect": true } });
      throw error;
    }
    if (tokens.refresh_token) await User.updateOne({ _id: id, "microsoftMail.refreshToken": previous }, { $set: { "microsoftMail.refreshToken": seal(tokens.refresh_token) } });
    return tokens.access_token;
  })().finally(() => refreshes.delete(id));
  refreshes.set(id, promise);
  return promise;
};

const sendMicrosoftMail = async (userId, message) => {
  const accessToken = await getAccessToken(userId);
  const recipients = value => (Array.isArray(value) ? value : String(value || "").split(",")).map(address => String(address).trim()).filter(Boolean).map(address => ({ emailAddress: { address } }));
  const toRecipients = recipients(message.to);
  if (!toRecipients.length) throw mailError("EMAIL_RECIPIENT_MISSING", "Email recipient is required.");
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject: message.subject, body: { contentType: message.html ? "HTML" : "Text", content: message.html || message.text || "" }, toRecipients, ccRecipients: recipients(message.cc), bccRecipients: recipients(message.bcc) }, saveToSentItems: true }),
  });
  if (response.status !== 202) throw mailError(response.status === 401 ? "MICROSOFT_RECONNECT_REQUIRED" : "MICROSOFT_SEND_FAILED", response.status === 403 ? "Microsoft denied sending. Your administrator may need to approve Mail.Send permission." : "Microsoft did not accept the email. Check your connection and try again.", 502);
  return { provider: "microsoft", messageId: response.headers.get("request-id") || crypto.randomUUID(), accepted: true };
};

module.exports = { getConfig, startConnection, completeConnection, assertMicrosoftConnection, sendMicrosoftMail, isOutlookAddress, seal, unseal };
