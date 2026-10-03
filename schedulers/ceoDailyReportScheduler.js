const cron = require("node-cron");
const { sendCeoDailyReport } = require("../services/ceoDailyReportService");

const startCeoDailyReportScheduler = () => {
  const timezone = process.env.CEO_DAILY_REPORT_TIMEZONE || "Asia/Kolkata";
  const noonCron = process.env.CEO_DAILY_REPORT_12PM_CRON || "0 12 * * *";
  const eveningCron = process.env.CEO_DAILY_REPORT_7PM_CRON || "0 19 * * *";

  const scheduleReport = (slot, expression) => {
    if (!cron.validate(expression)) {
      console.error(`[CEO Daily Report] Invalid cron for ${slot}: ${expression}`);
      return;
    }

    cron.schedule(
      expression,
      async () => {
        console.log(`[CEO Daily Report] Scheduled ${slot} report generation started.`);
        try {
          const result = await sendCeoDailyReport({ slot });
          if (result.skipped) {
            console.log(`[CEO Daily Report] ${slot} skipped: ${result.reason}`);
          } else {
            console.log(`[CEO Daily Report] ${slot} completed with status ${result.log.status}.`);
          }
        } catch (error) {
          console.error(`[CEO Daily Report] ${slot} failed:`, error.message);
        }
      },
      { timezone, timeZone: timezone }
    );

    console.log(`[CEO Daily Report] ${slot} scheduler started with cron "${expression}" in timezone "${timezone}".`);
  };

  scheduleReport("12PM", noonCron);
  scheduleReport("7PM", eveningCron);
};

module.exports = { startCeoDailyReportScheduler };
