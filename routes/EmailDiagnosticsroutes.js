const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { verifyEmailTransport, formatEmailErrorResponse } = require("../services/emailService");

const router = express.Router();

router.get("/diagnostics", protect, async (req, res) => {
    try {
        if (!["Admin", "Finance"].includes(req.user?.designation)) {
            return res.status(403).json({
                success: false,
                message: "Only Admin or Finance can run email diagnostics.",
            });
        }

        const result = await verifyEmailTransport();
        return res.status(200).json({
            success: true,
            message: "SMTP verification succeeded.",
            ...result,
        });
    } catch (error) {
        console.error("Email diagnostics failed:", error);
        return res.status(500).json({
            success: false,
            ...formatEmailErrorResponse(error),
        });
    }
});

module.exports = router;
