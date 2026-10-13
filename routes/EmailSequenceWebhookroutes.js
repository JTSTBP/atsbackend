const express = require("express");
const Communication = require("../models/Communication");
const logActivity = require("./logactivity");

const router = express.Router();

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const extractInbound = (body = {}) => {
  const event = body.data || body.event || body;
  const from =
    event.from ||
    event.fromEmail ||
    event.sender ||
    event.email ||
    event?.from?.email ||
    event?.from?.address ||
    event?.from?.emailAddress?.address ||
    "";
  const subject = event.subject || event.headers?.subject || body.subject || "";
  const text = event.text || event.textBody || event.body || event.html || body.text || body.body || "";
  const type = String(body.type || event.type || body.eventType || "").toLowerCase();
  const lowerText = String(text || "").toLowerCase();
  const kind =
    type.includes("bounce") ? "bounce" :
    type.includes("unsubscribe") || lowerText.includes("unsubscribe") ? "unsubscribe" :
    type.includes("automatic") || type.includes("auto_reply") || lowerText.includes("out of office") ? "automatic" :
    "reply";
  return { from: normalizeEmail(from), subject, body: String(text || ""), kind };
};

const verifyWebhook = (req) => {
  const secret = process.env.EMAIL_SEQUENCE_WEBHOOK_SECRET;
  if (!secret) return true;
  const supplied = req.get("x-email-sequence-secret") || req.query.secret || req.body.secret;
  return supplied && String(supplied) === String(secret);
};

router.post("/inbound", async (req, res) => {
  try {
    if (!verifyWebhook(req)) {
      return res.status(401).json({ success: false, message: "Invalid webhook secret" });
    }
    const inbound = extractInbound(req.body);
    if (!inbound.from) {
      return res.status(400).json({ success: false, message: "Inbound sender email is required" });
    }

    const active = await Communication.findOne({
      channel: "EMAIL",
      sequenceId: { $type: "string" },
      recipient: new RegExp(`^${inbound.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      status: { $in: ["scheduled", "pending", "sent", "failed"] },
    }).sort({ createdAt: -1 });

    if (!active) {
      return res.json({ success: true, matched: false });
    }

    const result = await Communication.updateMany({
      channel: "EMAIL",
      sequenceId: active.sequenceId,
      status: { $in: ["scheduled", "failed"] },
    }, {
      $set: {
        status: "stopped",
        stoppedAt: new Date(),
        stopReason: inbound.kind,
      },
    });

    await Communication.create({
      candidateId: active.candidateId,
      requirementId: active.requirementId,
      recruiterId: active.recruiterId,
      channel: "EMAIL",
      direction: "INBOUND",
      recipient: inbound.from,
      subject: inbound.subject || `Inbound ${inbound.kind}`,
      body: inbound.body || inbound.kind,
      status: "sent",
      sequenceId: active.sequenceId,
      stopReason: inbound.kind,
      sentAt: new Date(),
    });

    logActivity(active.recruiterId, "stopped", "candidate-email-sequence", `Email sequence stopped by ${inbound.kind}`, active.candidateId, "SourceCandidate", {
      actionType: "email_sequence_auto_stopped",
      candidateId: active.candidateId,
      jobId: active.requirementId,
      metadata: { sequenceId: active.sequenceId, from: inbound.from, kind: inbound.kind, stopped: result.modifiedCount },
    });

    res.json({ success: true, matched: true, sequenceId: active.sequenceId, stopped: result.modifiedCount, kind: inbound.kind });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to process inbound email" });
  }
});

module.exports = router;
