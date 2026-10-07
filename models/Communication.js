const mongoose = require("mongoose");

const communicationSchema = new mongoose.Schema(
  {
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "SourcedCandidate", required: true, index: true },
    requirementId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true, index: true },
    recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    channel: { type: String, enum: ["EMAIL", "WHATSAPP", "CALL"], required: true, index: true },
    direction: { type: String, enum: ["OUTBOUND", "INBOUND"], default: "OUTBOUND" },
    recipient: { type: String, required: true },
    subject: { type: String, default: "" },
    body: { type: String, required: true },
    status: { type: String, enum: ["generated", "pending", "sent", "failed", "not_configured"], default: "generated", index: true },
    providerMessageId: { type: String },
    errorMessage: { type: String },
    idempotencyKey: { type: String, index: true },
    sentAt: { type: Date },
  },
  { timestamps: true }
);

communicationSchema.index(
  { recruiterId: 1, channel: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

module.exports = mongoose.model("Communication", communicationSchema);
