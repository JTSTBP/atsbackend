const cron = require("node-cron");
const CeoDailyReportLog = require("../models/CeoDailyReportLog");
const { sendCeoDailyReport } = require("../services/ceoDailyReportService");

const REPORT_TYPE = "ceo_daily_ats_performance";
const pad = (value) => String(value).padStart(2, "0");

const getCurrentPartsInTimezone = (timezone) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const getPart = (type) => Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
    hour: getPart("hour"),
    minute: getPart("minute"),
  };
};

const getReportDate = ({ year, month, day }) => `${year}-${pad(month)}-${pad(day)}`;

const hasSuccessfulReport = async (reportDate, slot) => {
  const sentLog = await CeoDailyReportLog.exists({
    reportType: REPORT_TYPE,
    reportDate,
    reportSlot: slot,
    emailStatus: "sent",
  });
  return Boolean(sentLog);
};

const runDueCeoDailyReports = async (source = "catch-up") => {
  const timezone = process.env.CEO_DAILY_REPORT_TIMEZONE || "Asia/Kolkata";
  const now = getCurrentPartsInTimezone(timezone);
  const reportDate = getReportDate(now);
  const dueSlots = [];
  const results = [];

  if (now.hour > 12 || (now.hour === 12 && now.minute >= 0)) {
    dueSlots.push("12PM");
  }
  if (now.hour > 19 || (now.hour === 19 && now.minute >= 0)) {
    dueSlots.push("7PM");
  }

  if (!dueSlots.length) {
    return { reportDate, dueSlots, results };
  }

  for (const slot of dueSlots) {
    try {
      if (await hasSuccessfulReport(reportDate, slot)) {
        const skipped = { slot, skipped: true, reason: `Report already sent for ${reportDate}.` };
        console.log(`[CEO Daily Report] ${source} skipped ${slot}; ${skipped.reason}`);
        results.push(skipped);
        continue;
      }

      console.log(`[CEO Daily Report] ${source} sending missed ${slot} report for ${reportDate}.`);
      const result = await sendCeoDailyReport({ slot });
      if (result.skipped) {
        console.log(`[CEO Daily Report] ${source} ${slot} skipped: ${result.reason}`);
      } else {
        console.log(`[CEO Daily Report] ${source} ${slot} completed with status ${result.log.status}.`);
      }
      results.push({ slot, ...result });
    } catch (error) {
      console.error(`[CEO Daily Report] ${source} ${slot} failed:`, error.message);
      results.push({ slot, success: false, error: error.message });
    }
  }

  return { reportDate, dueSlots, results };
};

const startCeoDailyReportScheduler = () => {
  const timezone = process.env.CEO_DAILY_REPORT_TIMEZONE || "Asia/Kolkata";
  const noonCron = process.env.CEO_DAILY_REPORT_12PM_CRON || "0 12 * * *";
  const eveningCron = process.env.CEO_DAILY_REPORT_7PM_CRON || "0 19 * * *";
  const catchupIntervalMinutes = Number(process.env.CEO_DAILY_REPORT_CATCHUP_INTERVAL_MINUTES || 10);

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

  console.log(`[CEO Daily Report] Startup catch-up check enabled in timezone "${timezone}".`);
  runDueCeoDailyReports("startup catch-up");

  if (catchupIntervalMinutes > 0) {
    setInterval(() => {
      runDueCeoDailyReports("interval catch-up");
    }, catchupIntervalMinutes * 60 * 1000);
    console.log(`[CEO Daily Report] Interval catch-up check running every ${catchupIntervalMinutes} minutes.`);
  }
};

module.exports = { startCeoDailyReportScheduler, runDueCeoDailyReports };
