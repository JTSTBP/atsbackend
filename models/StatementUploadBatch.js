const mongoose = require("mongoose");

const statementUploadBatchSchema = new mongoose.Schema(
    {
        bulkUploadId: {
            type: String,
            required: true,
            unique: true,
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
        originalFilename: {
            type: String,
            required: true,
            trim: true,
        },
        totalRows: {
            type: Number,
            required: true,
            default: 0,
        },
        successfulRows: {
            type: Number,
            required: true,
            default: 0,
        },
        failedRows: {
            type: Number,
            required: true,
            default: 0,
        },
        status: {
            type: String,
            enum: ["completed", "completed_with_errors", "failed"],
            required: true,
        },
        validationErrors: [
            {
                row: Number,
                errors: [String],
            },
        ],
        duplicateRows: [
            {
                row: Number,
                accountNumber: String,
                transactionType: String,
                amount: Number,
                reason: String,
                errors: [String],
            },
        ],
        totalAmountDebited: {
            type: Number,
            default: 0,
        },
        totalAmountCredited: {
            type: Number,
            default: 0,
        },
        ignoredEmptyRows: {
            type: Number,
            default: 0,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("StatementUploadBatch", statementUploadBatchSchema);
