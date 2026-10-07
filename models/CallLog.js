const mongoose = require("mongoose");

const callLogSchema = new mongoose.Schema(
  {
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "SourcedCandidate", required: true, index: true },
    requirementId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true, index: true },
    recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    callDate: { type: Date, required: true, index: true },
    callTime: { type: String, required: true },
    status: {
      type: String,
      enum: ["Connected", "No Answer", "Busy", "Switched Off", "Not Reachable", "Call Back Later"],
      required: true,
    },
    outcome: {
      type: String,
      enum: [
        "Interested",
        "Not Interested",
        "Call Back",
        "Need More Information",
        "Interview Interested",
        "Salary Issue",
        "Location Issue",
        "Notice Period Issue",
        "Wrong Number",
        "Other",
      ],
      default: "Other",
    },
    notes: { type: String, default: "" },
    nextFollowUpDate: { type: Date },
    nextFollowUpTime: { type: String },
  },
  { timestamps: true }
);

callLogSchema.index({ candidateId: 1, createdAt: -1 });
callLogSchema.index({ recruiterId: 1, callDate: -1 });

module.exports = mongoose.model("CallLog", callLogSchema);
