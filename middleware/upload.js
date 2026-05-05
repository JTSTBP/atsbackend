const multer = require("multer");
const { resumeStorage } = require("../config/s3Config");

const upload = multer({
  storage: resumeStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

module.exports = upload;

