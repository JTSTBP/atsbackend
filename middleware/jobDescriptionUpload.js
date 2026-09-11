const multer = require("multer");
const { jobDescriptionStorage } = require("../config/s3Config");

const jobDescriptionUpload = multer({
  storage: jobDescriptionStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
  fileFilter: (req, file, cb) => {
    // Check extension and mime type for documents
    const allowedExtensions = /\.(pdf|doc|docx|txt|rtf)$/i;
    const allowedMimeTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "application/rtf"
    ];

    if (allowedMimeTypes.includes(file.mimetype) || file.originalname.match(allowedExtensions)) {
      cb(null, true);
    } else {
      cb(new Error("Only document files (.pdf, .doc, .docx, .txt, .rtf) are allowed"), false);
    }
  },
});

module.exports = jobDescriptionUpload;
