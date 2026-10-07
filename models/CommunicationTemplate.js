const mongoose = require("mongoose");

const communicationTemplateSchema = new mongoose.Schema(
  {
    templateName: { type: String, required: true },
    type: { type: String, enum: ["EMAIL", "WHATSAPP"], required: true, index: true },
    category: { type: String, required: true, index: true },
    subject: { type: String, default: "" },
    body: { type: String, required: true },
    variables: [{ type: String }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

communicationTemplateSchema.index({ type: 1, category: 1, isActive: 1 });

module.exports = mongoose.model("CommunicationTemplate", communicationTemplateSchema);
