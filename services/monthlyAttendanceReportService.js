const nodemailer = require("nodemailer");
const Attendance = require("../models/Attendance");
const User = require("../models/Users");
const AttendanceReportLog = require("../models/AttendanceReportLog");

const REPORT_TYPE = "monthly_recruiter_attendance";

const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

const SHORT_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const getDateOnly = (dateValue) => {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const formatDateReport = (dateValue) => {
    const date = getDateOnly(dateValue);
    if (!date) return "";
    return `${String(date.getDate()).padStart(2, "0")} ${SHORT_MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
};

const countWorkingDaysExcludingSundays = (start, end) => {
    if (!start || !end || start > end) return 0;
    let workingDays = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
        if (cursor.getDay() !== 0) {
            workingDays++;
        }
        cursor.setDate(cursor.getDate() + 1);
    }
    return workingDays;
};

const isSunday = (dateValue) => {
    const date = getDateOnly(dateValue);
    return date ? date.getDay() === 0 : false;
};

const getPreviousMonthRange = (referenceDate = new Date()) => {
    const istDateParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: process.env.MONTHLY_ATTENDANCE_TIMEZONE || "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(referenceDate);

    const year = Number(istDateParts.find((part) => part.type === "year")?.value);
    const month = Number(istDateParts.find((part) => part.type === "month")?.value);

    const previousMonthStart = new Date(year, month - 2, 1, 0, 0, 0, 0);
    const previousMonthEnd = new Date(year, month - 1, 0, 23, 59, 59, 999);
    const reportMonth = `${previousMonthStart.getFullYear()}-${String(previousMonthStart.getMonth() + 1).padStart(2, "0")}`;

    return {
        startDate: previousMonthStart,
        endDate: previousMonthEnd,
        reportMonth,
        monthName: MONTH_NAMES[previousMonthStart.getMonth()],
        year: previousMonthStart.getFullYear(),
        reportingPeriod: `${formatDateReport(previousMonthStart)} - ${formatDateReport(previousMonthEnd)}`,
    };
};

const getRecruiterMonthlyAttendance = async (startDate, endDate) => {
    const recruiters = await User.find({
        designation: /^Recruiter$/i,
    }).select("_id name email designation");

    const recruiterIds = recruiters.map((user) => user._id);
    const records = recruiterIds.length
        ? await Attendance.find({
            user: { $in: recruiterIds },
            date: { $gte: startDate, $lte: endDate },
        })
            .sort({ date: 1 })
            .populate("user", "name email designation")
        : [];

    return { recruiters, records };
};

const buildRecruiterSummaries = (recruiters, records, period) => {
    const recordsByUser = {};
    records.forEach((record) => {
        if (!record.user) return;
        const userId = record.user._id.toString();
        if (!recordsByUser[userId]) {
            recordsByUser[userId] = [];
        }
        recordsByUser[userId].push(record);
    });

    const scheduledWorkdays = countWorkingDaysExcludingSundays(period.startDate, period.endDate);

    return recruiters.map((recruiter) => {
        const recruiterRecords = recordsByUser[recruiter._id.toString()] || [];
        const nonSundayRecords = recruiterRecords.filter((record) => !isSunday(record.date));

        const presentDays = nonSundayRecords.filter((record) => record.status === "Present").length;
        const halfDays = nonSundayRecords.filter((record) => record.status === "Half Day").length;
        const attendedDays = presentDays + halfDays;
        const absentDays = Math.max(0, scheduledWorkdays - presentDays - halfDays);

        return {
            recruiter,
            scheduledWorkdays,
            attendedDays,
            presentDays,
            halfDays,
            absentDays,
        };
    });
};

const buildMonthlyRecruiterAttendanceEmail = (reportData, period) => {
    const rowsHtml = reportData.summaries.map((summary) => `
        <tr>
            <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; font-weight: bold; color: #1e293b;">${summary.recruiter.name}</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; text-align: right;">${summary.scheduledWorkdays}</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; text-align: right; font-weight: bold;">${summary.attendedDays}</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; text-align: right; color: #16a34a; font-weight: bold;">${summary.presentDays}</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; text-align: right; color: #2563eb; font-weight: bold;">${summary.halfDays}</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-size: 13px; text-align: right; color: #dc2626; font-weight: bold;">${summary.absentDays}</td>
        </tr>
    `).join("");

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Monthly Recruiter Attendance Report</title>
        </head>
        <body style="background-color: #f3f4f6; margin: 0; padding: 20px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
            <div style="max-width: 800px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                <div style="background-color: #1e3a8a; padding: 25px; text-align: center; border-bottom: 4px solid #2563eb;">
                    <h2 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold; letter-spacing: 0.5px;">Jobs Territory</h2>
                    <p style="color: #93c5fd; margin: 5px 0 0 0; font-size: 14px;">Attendance Management System</p>
                </div>
                <div style="padding: 30px; color: #1f2937; line-height: 1.6;">
                    <p style="font-size: 16px; margin-top: 0;">Hello Admin,</p>
                    <p style="font-size: 15px;">Please find below the monthly recruiter attendance summary for <strong>${period.reportingPeriod}</strong>.</p>
                    <table style="width: 100%; border-collapse: collapse; margin: 20px 0 25px 0; font-family: sans-serif;">
                        <tbody>
                            <tr>
                                <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px; font-weight: bold; background-color: #f8fafc;">Reporting Period</td>
                                <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px;">${period.reportingPeriod}</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px; font-weight: bold; background-color: #f8fafc;">Recruiters Included</td>
                                <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px;">${reportData.summaries.length}</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px; font-weight: bold; background-color: #f8fafc;">Total Working Days</td>
                                <td style="padding: 10px; border: 1px solid #ddd; font-size: 14px;">${reportData.scheduledWorkdays}</td>
                            </tr>
                        </tbody>
                    </table>
                    <h3 style="color: #1e3a8a; margin-top: 35px; margin-bottom: 15px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; font-size: 18px;">Recruiter Attendance Summary</h3>
                    <div style="overflow-x: auto; margin-bottom: 30px;">
                        <table style="width: 100%; border-collapse: collapse; font-family: sans-serif; min-width: 600px;">
                            <thead>
                                <tr style="background-color: #1e3a8a; color: #ffffff;">
                                    <th style="padding: 10px; border: 1px solid #ddd; text-align: left; font-size: 13px;">Recruiter Name</th>
                                    <th style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 13px;">Total Working Days</th>
                                    <th style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 13px;">Total Days Worked</th>
                                    <th style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 13px;">Present Days</th>
                                    <th style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 13px;">Half Days</th>
                                    <th style="padding: 10px; border: 1px solid #ddd; text-align: right; font-size: 13px;">Absent Days</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml || `<tr><td colspan="6" style="padding: 15px; text-align: center; color: #64748b;">No recruiters found for this report.</td></tr>`}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div style="background-color: #f8fafc; padding: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #64748b; font-size: 12px;">
                    <p style="margin: 0;">This is an automated monthly attendance report. Do not reply directly to this email.</p>
                    <p style="margin: 5px 0 0 0;">&copy; 2026 Jobs Territory. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;
};

const sendEmail = async ({ recipient, subject, html }) => {
    const emailUser = process.env.EMAIL_ID;
    const emailPass = process.env.APP_PASSWORD;
    const replyToEmail = process.env.SENDER_ID;

    if (!emailUser || !emailPass) {
        throw new Error("Email SMTP credentials (EMAIL_ID or APP_PASSWORD) are not configured on the server.");
    }

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: emailUser.trim(),
            pass: emailPass.trim(),
        },
    });

    const mailOptions = {
        from: `"Jobs Territory Attendance" <${emailUser.trim()}>`,
        to: recipient.trim(),
        subject,
        html,
    };

    if (replyToEmail) {
        mailOptions.replyTo = replyToEmail.trim();
    }

    await transporter.sendMail(mailOptions);
};

const sendMonthlyRecruiterAttendanceReport = async ({ force = false, referenceDate = new Date() } = {}) => {
    const period = getPreviousMonthRange(referenceDate);
    const recipient = process.env.MONTHLY_ATTENDANCE_RECIPIENT || process.env.SENDER_ID;

    console.log("[Attendance Scheduler] Monthly report generation started.");
    console.log(`[Attendance Scheduler] Reporting period: ${period.reportingPeriod} (${period.reportMonth})`);

    if (!recipient) {
        throw new Error("MONTHLY_ATTENDANCE_RECIPIENT or SENDER_ID must be configured.");
    }

    const existingSentLog = await AttendanceReportLog.findOne({
        reportType: REPORT_TYPE,
        reportMonth: period.reportMonth,
        status: "sent",
    });

    if (existingSentLog && !force) {
        console.log(`[Attendance Scheduler] Report skipped because it was already sent for ${period.reportMonth}.`);
        return { skipped: true, period };
    }

    const { recruiters, records } = await getRecruiterMonthlyAttendance(period.startDate, period.endDate);
    const summaries = buildRecruiterSummaries(recruiters, records, period);
    const scheduledWorkdays = countWorkingDaysExcludingSundays(period.startDate, period.endDate);

    console.log(`[Attendance Scheduler] Recruiters included: ${summaries.length}`);

    const html = buildMonthlyRecruiterAttendanceEmail({ summaries, scheduledWorkdays }, period);
    const subject = `Monthly Recruiter Attendance Report - ${period.monthName} ${period.year}`;

    try {
        await sendEmail({ recipient, subject, html });

        await AttendanceReportLog.create({
            reportType: REPORT_TYPE,
            reportMonth: period.reportMonth,
            status: "sent",
            sentAt: new Date(),
            recipient,
        });

        console.log(`[Attendance Scheduler] Monthly recruiter attendance email sent successfully to ${recipient}.`);
        return { skipped: false, sent: true, period, recruiterCount: summaries.length };
    } catch (error) {
        console.error("[Attendance Scheduler] Email sending failure:", error.message);
        await AttendanceReportLog.create({
            reportType: REPORT_TYPE,
            reportMonth: period.reportMonth,
            status: "failed",
            recipient,
            errorMessage: error.message,
        }).catch((logError) => {
            console.error("[Attendance Scheduler] Failed to write failure log:", logError.message);
        });
        throw error;
    }
};

module.exports = {
    getPreviousMonthRange,
    getRecruiterMonthlyAttendance,
    buildMonthlyRecruiterAttendanceEmail,
    sendMonthlyRecruiterAttendanceReport,
};
