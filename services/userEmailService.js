const User = require("../models/Users");
const { sendMail } = require("./emailService");
const { assertMicrosoftConnection, sendMicrosoftMail, isOutlookAddress } = require("./microsoftMailService");

const credentialError = (code, message) => Object.assign(new Error(message), {
  code, status: 400, provider: "smtp",
});

// Read credentials from the database at send time; never accept them from a browser.
const getUserEmailOptions = async (userId) => {
  const id = userId?._id || userId;
  if (!id) throw credentialError("SENDER_NOT_FOUND", "The email sender is unavailable. Please sign in again.");
  const user = await User.findById(id).select("name email appPassword isDisabled followUpEmailProvider microsoftMail").lean();
  if (!user || user.isDisabled) throw credentialError("SENDER_UNAVAILABLE", "The email sender account is unavailable or disabled.");
  const email = String(user.email || "").trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    throw credentialError("USER_EMAIL_MISSING", "Save a valid email address in your user profile before sending follow-up emails.");
  }
  if (user.followUpEmailProvider === "microsoft" || isOutlookAddress(email)) {
    assertMicrosoftConnection(user);
    return { provider: "microsoft", from: email, replyTo: email, senderId: id };
  }
  let password = String(user.appPassword || "").trim();
  if ((password.startsWith('"') && password.endsWith('"')) || (password.startsWith("'") && password.endsWith("'"))) password = password.slice(1, -1).trim();
  if (process.env.SMTP_KEEP_PASSWORD_SPACES !== "true") password = password.replace(/\s+/g, "");
  if (!password.replace(/\s/g, "")) {
    throw credentialError("USER_APP_PASSWORD_MISSING", "Your account has no email app password saved. Open Profile, add your email app password, and try again.");
  }
  return {
    provider: "smtp",
    fromName: user.name || "Recruitment Team",
    from: email,
    replyTo: email,
    auth: { user: email, pass: password },
  };
};

const sendUserMail = async (userId, message) => {
  const options = await getUserEmailOptions(userId);
  if (options.provider === "microsoft") return sendMicrosoftMail(options.senderId, message);
  // Apply identity/authentication last so caller data cannot override the sender.
  try {
    return await sendMail({ ...message, ...options });
  } catch (error) {
    if (["SMTP_AUTH_FAILED", "EAUTH"].includes(error.code) || Number(error.responseCode) === 535) {
      const rejected = credentialError("USER_APP_PASSWORD_REJECTED", "Your email provider rejected the saved app password. Open Profile and enter a valid app password for your email address, then try again. Your provider may also require SMTP access to be enabled.");
      rejected.traceId = error.traceId;
      throw rejected;
    }
    throw error;
  }
};

module.exports = { getUserEmailOptions, sendUserMail };
