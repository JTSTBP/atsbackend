const multer = require("multer");
const { clientLogoStorage } = require("../config/s3Config");

const clientUpload = multer({
    storage: clientLogoStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

module.exports = clientUpload;
