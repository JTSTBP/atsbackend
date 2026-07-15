const mongoose = require("mongoose");

const AttendanceReportLogSchema = new mongoose.Schema(
    {
        reportType: {
            type: String,
            required: true,
            index: true,
        },
        reportMonth: {
            type: String,
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ["sent", "failed"],
            required: true,
            index: true,
        },
        sentAt: {
            type: Date,
        },
        recipient: {
            type: String,
            required: true,
        },
        errorMessage: {
            type: String,
        },
    },
    { timestamps: true }
);

AttendanceReportLogSchema.index(
    { reportType: 1, reportMonth: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: "sent" } }
);

module.exports = mongoose.model("AttendanceReportLog", AttendanceReportLogSchema);
