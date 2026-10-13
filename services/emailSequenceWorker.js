const Communication = require("../models/Communication");
const { sendMail, formatEmailErrorResponse } = require("./emailService");

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
  await communication.populate("recruiterId", "name email");
  const recruiter = communication.recruiterId || {};
  const result = communication.channel === "WHATSAPP" ? await sendWhatsAppMessage({ to: communication.recipient, body: communication.body }) : await sendMail({
    fromName: recruiter.name || "Jobs Territory",
    from: recruiter.email,
    to: communication.recipient,
    subject: communication.subject,
    html: renderHtml(communication.body),
    text: communication.body,
    replyTo: recruiter.email,
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
  const due = await Communication.find({
    channel: { $in: ["EMAIL", "WHATSAPP"] },
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
