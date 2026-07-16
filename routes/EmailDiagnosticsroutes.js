const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { verifyEmailTransport, getEmailDiagnostics, formatEmailErrorResponse } = require("../services/emailService");

const router = express.Router();

router.get("/diagnostics", protect, async (req, res) => {
    try {
        if (!["Admin", "Finance"].includes(req.user?.designation)) {
            return res.status(403).json({
                success: false,
                message: "Only Admin or Finance can run email diagnostics.",
            });
        }

        const diagnostics = await getEmailDiagnostics();
        const result = await verifyEmailTransport();
        return res.status(200).json({
            success: true,
            message: "SMTP verification succeeded.",
            diagnostics,
            ...result,
        });
    } catch (error) {
        console.error("Email diagnostics failed:", error);
        const diagnostics = await getEmailDiagnostics().catch(diagnosticError => ({
            error: diagnosticError.message,
        }));
        return res.status(500).json({
            success: false,
            diagnostics,
            ...formatEmailErrorResponse(error),
        });
    }
});

module.exports = router;
