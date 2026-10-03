const mongoose = require("mongoose");

const CeoDailyReportSettingsSchema = new mongoose.Schema(
  {
    enable12PmReport: {
      type: Boolean,
      default: true,
    },
    enable7PmReport: {
      type: Boolean,
      default: true,
    },
    emailRecipients: {
      type: [String],
      default: [],
    },
    ccRecipients: {
      type: [String],
      default: [],
    },
    timezone: {
      type: String,
      default: "Asia/Kolkata",
    },
    dashboardUrl: {
      type: String,
      default: "",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CeoDailyReportSettings", CeoDailyReportSettingsSchema);
