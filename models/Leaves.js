const mongoose = require("mongoose");
const User = require("./Users");

const leaveSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    leaveType: { type: String, required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    leaveCategory: {
      type: String,
      enum: ["Full Day", "Half Day"],
      default: "Full Day",
    },
    halfDayPeriod: {
      type: String,
      enum: ["First Half", "Second Half"],
    },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    statusUpdated: { type: String },
    appliedDate: { type: Date, default: Date.now },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LeaveApplication", leaveSchema);
