const Communication = require("../models/Communication");
const { formatEmailErrorResponse } = require("./emailService");

const { sendUserMail } = require("./userEmailService");
const { sendWhatsAppMessage } = require("./whatsappService");

const DEFAULT_INTERVALS_MINUTES = [0, 4320, 10080, 14400, 20160];

const getSequenceIntervals = () => {
  const raw = process.env.EMAIL_SEQUENCE_INTERVAL_MINUTES || "";
  const parsed = raw.split(",").map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value >= 0);
  return parsed.length >= 5 ? parsed.slice(0, 5) : DEFAULT_INTERVALS_MINUTES;
};

const scheduleForStep = (step, startedAt = new Date()) => {
  const intervals = getSequenceIntervals();
  const minutes = intervals[step] ?? intervals[intervals.length - 1] ?? 0;
  return new Date(startedAt.getTime() + minutes * 60 * 1000);
};

const renderHtml = (body) => String(body || "").replace(/\n/g, "<br/>");

const sendCommunication = async (communication) => {
  const result = communication.channel === "WHATSAPP" ? await sendWhatsAppMessage({ to: communication.recipient, body: communication.body }) : await sendUserMail(communication.recruiterId, {
    to: communication.recipient,
    subject: communication.subject,
    html: renderHtml(communication.body),
    text: communication.body,
  });
  communication.status = "sent";
  communication.providerMessageId = result.messageId || result.traceId;
  communication.sentAt = new Date();
  communication.errorMessage = undefined;
  await communication.save();
  return communication;
};

const runEmailSequenceWorkerOnce = async () => {
  const now = new Date();
  await Communication.updateMany({ channel: "WHATSAPP", sequenceId: { $type: "string" }, status: { $in: ["generated", "reviewed", "scheduled", "failed"] } }, { $set: { status: "stopped", stoppedAt: now, stopReason: "whatsapp_direct_messages_only" } });
  const due = await Communication.find({
    channel: "EMAIL",
    sequenceId: { $type: "string" },
    status: "scheduled",
    scheduledAt: { $lte: now },
  }).sort({ scheduledAt: 1 }).limit(Number(process.env.EMAIL_SEQUENCE_WORKER_BATCH || 10));

  let sent = 0;
  let failed = 0;
  for (const item of due) {
    const claimed = await Communication.findOneAndUpdate(
      { _id: item._id, status: "scheduled" },
      { $set: { status: "pending", claimedAt: new Date() } },
      { new: true }
    );
    if (!claimed) continue;
    try {
      await sendCommunication(claimed);
      sent += 1;
    } catch (error) {
      claimed.status = "failed";
      claimed.errorMessage = JSON.stringify(formatEmailErrorResponse(error));
      await claimed.save();
      if (["USER_APP_PASSWORD_MISSING", "USER_APP_PASSWORD_REJECTED", "MICROSOFT_RECONNECT_REQUIRED", "SENDER_UNAVAILABLE"].includes(error.code)) {
        await Communication.updateMany({ sequenceId: claimed.sequenceId, recruiterId: claimed.recruiterId, status: "scheduled" }, { $set: { status: "stopped", stoppedAt: new Date(), stopReason: error.code, errorMessage: claimed.errorMessage } });
      }
      failed += 1;
    }
  }
  return { checked: due.length, sent, failed };
};

const startEmailSequenceWorker = () => {
  if (process.env.EMAIL_SEQUENCE_WORKER_ENABLED === "false") {
    console.log("Email sequence worker disabled");
    return null;
  }
  const intervalMs = Number(process.env.EMAIL_SEQUENCE_WORKER_INTERVAL_MS || 60000);
  const run = () => runEmailSequenceWorkerOnce().catch((error) => {
    console.error("Email sequence worker failed:", error.message);
  });
  setTimeout(run, 5000);
  const timer = setInterval(run, Number.isFinite(intervalMs) && intervalMs >= 10000 ? intervalMs : 60000);
  console.log("Email sequence worker started");
  return timer;
};

module.exports = {
  getSequenceIntervals,
  runEmailSequenceWorkerOnce,
  scheduleForStep,
  sendCommunication,
  startEmailSequenceWorker,
};
