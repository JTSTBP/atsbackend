const mongoose = require("mongoose");

const followUpSchema = new mongoose.Schema(
  {
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "SourcedCandidate", required: true, index: true },
    requirementId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true, index: true },
    recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: ["Call", "Email", "WhatsApp", "Interview Reminder", "JD Sharing", "General Follow-up", "Joining Reminder", "Custom"],
      required: true,
    },
    dueDate: { type: Date, required: true, index: true },
    dueTime: { type: String, required: true },
    status: {
      type: String,
      enum: ["Pending", "Completed", "Cancelled", "Overdue"],
      default: "Pending",
      index: true,
    },
    notes: { type: String, default: "" },
    relatedCommunication: { type: mongoose.Schema.Types.ObjectId, ref: "Communication" },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

followUpSchema.index({ recruiterId: 1, status: 1, dueDate: 1 });
followUpSchema.index({ requirementId: 1, status: 1, dueDate: 1 });

module.exports = mongoose.model("FollowUp", followUpSchema);
