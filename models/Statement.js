const mongoose = require("mongoose");

const statementSchema = new mongoose.Schema(
    {
        accountNumber: {
            type: String,
            required: true,
            trim: true,
        },
        transactionType: {
            type: String,
            enum: ["debited", "credited"],
            required: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 0,
        },
        reason: {
            type: String,
            required: true,
            trim: true,
        },
        fingerprint: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        bulkUploadId: {
            type: String,
            required: true,
            index: true,
        },
        uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        uploadedAt: {
            type: Date,
            default: Date.now,
            required: true,
        },
        source: {
            type: String,
            required: true,
            trim: true,
            default: "excel_upload",
        },
    },
    { timestamps: true }
);

statementSchema.index({ bulkUploadId: 1, accountNumber: 1 });

module.exports = mongoose.model("Statement", statementSchema);
