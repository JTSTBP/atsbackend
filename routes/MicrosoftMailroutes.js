const express = require("express");
const User = require("../models/Users");
const { protect } = require("../middleware/authMiddleware");
const { getConfig, startConnection, completeConnection, isOutlookAddress } = require("../services/microsoftMailService");
const router = express.Router();

router.get("/callback", async (req, res) => {
  let result = { type: "ats-microsoft-mail", success: true, message: "Microsoft email connected. You can close this window." };
  try { await completeConnection(req.query); }
  catch (error) { result = { ...result, success: false, message: error.code ? error.message : "Microsoft connection failed. Please try again." }; }
  let origin;
  try { origin = getConfig().frontendOrigin; } catch { origin = null; }
  const nonce = require("crypto").randomBytes(16).toString("base64");
  const data = JSON.stringify(result).replace(/</g, "\\u003c");
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
  res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Microsoft email</title></head><body><p id="result"></p><script nonce="${nonce}">const data=${data};document.getElementById('result').textContent=data.message;if(window.opener && ${JSON.stringify(origin)}){window.opener.postMessage(data,${JSON.stringify(origin)});window.close();}</script></body></html>`);
});

router.use(protect);
router.get("/status", async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("email followUpEmailProvider microsoftMail isDisabled").lean();
    if (!user || user.isDisabled) return res.status(403).json({ message: "Account unavailable" });
    let configured = true;
    try { getConfig(); } catch { configured = false; }
    res.set("Cache-Control", "no-store");
    res.json({ configured, provider: user.followUpEmailProvider || "smtp", email: user.email,
      connected: Boolean(user.microsoftMail?.refreshToken) && !user.microsoftMail.needsReconnect && user.microsoftMail.email === user.email.trim().toLowerCase(),
      microsoftRequired: isOutlookAddress(user.email) || user.followUpEmailProvider === "microsoft" });
  } catch { res.status(500).json({ message: "Unable to load email connection" }); }
});

router.post("/connect", async (req, res) => {
  try { res.set("Cache-Control", "no-store"); res.json({ url: await startConnection(req.user._id) }); }
  catch (error) { res.status(error.status || 500).json({ message: error.code ? error.message : "Unable to start Microsoft sign-in" }); }
});

router.delete("/connection", async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $unset: { microsoftMail: "" }, $set: { followUpEmailProvider: "smtp" } });
    res.json({ success: true });
  } catch { res.status(500).json({ message: "Unable to disconnect Microsoft email" }); }
});

module.exports = router;
