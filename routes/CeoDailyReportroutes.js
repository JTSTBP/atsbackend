const express = require("express");
const CeoDailyReportLog = require("../models/CeoDailyReportLog");
const { protect } = require("../middleware/authMiddleware");
const { runDueCeoDailyReports } = require("../schedulers/ceoDailyReportScheduler");
const {
  getSettings,
  updateSettings,
  generateCeoDailyReportData,
  buildHtmlReport,
  buildPdfReportBuffer,
  sendCeoDailyReport,
} = require("../services/ceoDailyReportService");

const router = express.Router();

router.post("/cron/run-due", async (req, res) => {
  try {
    const configuredSecret = process.env.CEO_DAILY_REPORT_CRON_SECRET;
    const providedSecret = req.headers["x-cron-secret"] || req.query.secret;

    if (!configuredSecret) {
      return res.status(404).json({ success: false, message: "Cron endpoint is not configured" });
    }

    if (providedSecret !== configuredSecret) {
      return res.status(401).json({ success: false, message: "Invalid cron secret" });
    }

    const result = await runDueCeoDailyReports("external cron");
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

const requireAdmin = (req, res, next) => {
  if (req.user?.designation !== "Admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  next();
};

router.use(protect, requireAdmin);

router.get("/settings", async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const settings = await updateSettings(req.body, req.user._id);
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/preview/:slot", async (req, res) => {
  try {
    const settings = await getSettings();
    const slot = req.params.slot === "7PM" ? "7PM" : "12PM";
    const data = await generateCeoDailyReportData({ slot, timezone: settings.timezone });
    res.json({
      success: true,
      data,
      html: buildHtmlReport(data),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/preview/:slot/pdf", async (req, res) => {
  try {
    const settings = await getSettings();
    const slot = req.params.slot === "7PM" ? "7PM" : "12PM";
    const data = await generateCeoDailyReportData({ slot, timezone: settings.timezone });
    const pdfBuffer = await buildPdfReportBuffer(data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="ATS_Daily_Performance_Report_${slot}_${data.period.reportDate}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/send/:slot", async (req, res) => {
  try {
    const slot = req.params.slot === "7PM" ? "7PM" : "12PM";
    const result = await sendCeoDailyReport({
      slot,
      force: Boolean(req.body.force),
      test: Boolean(req.body.test),
      triggeredBy: req.user._id,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/test-email", async (req, res) => {
  try {
    const result = await sendCeoDailyReport({
      slot: req.body.slot === "7PM" ? "7PM" : "12PM",
      force: true,
      test: true,
      triggeredBy: req.user._id,
      channels: ["email"],
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/history", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      CeoDailyReportLog.find()
        .select("-html")
        .sort({ generatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("triggeredBy", "name email designation")
        .lean(),
      CeoDailyReportLog.countDocuments(),
    ]);

    res.json({
      success: true,
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/history/:id/pdf", async (req, res) => {
  try {
    const log = await CeoDailyReportLog.findById(req.params.id);
    if (!log) return res.status(404).json({ success: false, message: "Report not found" });

    const reportData = log.reportData && log.reportData.period
      ? log.reportData
      : await generateCeoDailyReportData({
        slot: log.reportSlot,
        timezone: log.timezone || "Asia/Kolkata",
        referenceDate: log.periodEnd || new Date(),
      });

    const pdfBuffer = await buildPdfReportBuffer(reportData);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="ATS_Daily_Performance_Report_${log.reportSlot}_${log.reportDate}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("[CEO Daily Report] PDF download failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/history/:id", async (req, res) => {
  try {
    const log = await CeoDailyReportLog.findById(req.params.id).populate("triggeredBy", "name email designation");
    if (!log) return res.status(404).json({ success: false, message: "Report not found" });
    res.json({ success: true, log });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/history/:id/resend", async (req, res) => {
  try {
    const existing = await CeoDailyReportLog.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Report not found" });

    const result = await sendCeoDailyReport({
      slot: existing.reportSlot,
      force: true,
      test: true,
      triggeredBy: req.user._id,
      referenceDate: existing.periodEnd || new Date(),
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
