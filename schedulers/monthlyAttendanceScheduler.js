const cron = require("node-cron");
const { sendMonthlyRecruiterAttendanceReport } = require("../services/monthlyAttendanceReportService");

const getCurrentDayInTimezone = (timeZone) => {
    const day = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        day: "2-digit",
    }).format(new Date());
    return Number(day);
};

const startMonthlyAttendanceScheduler = () => {
    const cronExpression = process.env.MONTHLY_ATTENDANCE_CRON || "0 9 1 * *";
    const timezone = process.env.MONTHLY_ATTENDANCE_TIMEZONE || "Asia/Kolkata";

    if (!cron.validate(cronExpression)) {
        console.error(`[Attendance Scheduler] Invalid MONTHLY_ATTENDANCE_CRON: ${cronExpression}`);
        return;
    }

    cron.schedule(
        cronExpression,
        async () => {
            try {
                await sendMonthlyRecruiterAttendanceReport();
            } catch (error) {
                console.error("[Attendance Scheduler] Scheduled monthly report failed:", error.message);
            }
        },
        { timezone, timeZone: timezone }
    );

    console.log(`[Attendance Scheduler] Scheduler started with cron "${cronExpression}" in timezone "${timezone}".`);

    if (getCurrentDayInTimezone(timezone) === 1) {
        console.log("[Attendance Scheduler] Startup catch-up check running for previous month report.");
        sendMonthlyRecruiterAttendanceReport().catch((error) => {
            console.error("[Attendance Scheduler] Startup catch-up failed:", error.message);
        });
    }
};

module.exports = { startMonthlyAttendanceScheduler };
