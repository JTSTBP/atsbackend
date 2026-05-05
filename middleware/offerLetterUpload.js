const multer = require("multer");
const { offerLetterStorage } = require("../config/s3Config");

const offerLetterUpload = multer({
    storage: offerLetterStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

module.exports = offerLetterUpload;

