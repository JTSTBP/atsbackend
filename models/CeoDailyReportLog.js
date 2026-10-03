const mongoose = require("mongoose");

const CeoDailyReportLogSchema = new mongoose.Schema(
  {
    reportType: {
      type: String,
      default: "ceo_daily_ats_performance",
      index: true,
    },
    reportDate: {
      type: String,
      required: true,
      index: true,
    },
    reportSlot: {
      type: String,
      enum: ["12PM", "7PM"],
      required: true,
      index: true,
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    periodStart: Date,
    periodEnd: Date,
    timezone: String,
    emailStatus: {
      type: String,
      enum: ["not_configured", "pending", "sent", "failed", "skipped"],
      default: "pending",
    },
    status: {
      type: String,
      enum: ["success", "partial", "failed"],
      default: "success",
      index: true,
    },
    recipients: [String],
    ccRecipients: [String],
    subject: String,
    html: String,
    text: String,
    summary: mongoose.Schema.Types.Mixed,
    reportData: mongoose.Schema.Types.Mixed,
    emailError: String,
    triggeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

CeoDailyReportLogSchema.index(
  { reportType: 1, reportDate: 1, reportSlot: 1, emailStatus: 1 },
  { unique: true, partialFilterExpression: { emailStatus: "sent" } }
);

module.exports = mongoose.model("CeoDailyReportLog", CeoDailyReportLogSchema);
