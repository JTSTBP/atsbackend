const multer = require("multer");
const { profilePhotoStorage } = require("../config/s3Config");

const profileUpload = multer({
    storage: profilePhotoStorage,
    limits: {
        fileSize: 1024 * 1024 * 5 // 5MB limit
    }
});

module.exports = profileUpload;
