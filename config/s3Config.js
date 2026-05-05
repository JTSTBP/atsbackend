const AWS = require('aws-sdk'); // Configured for multer-s3 v2
const multerS3 = require('multer-s3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Check if Cloudflare R2 or AWS credentials are configured
const hasR2Credentials = !!(
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_ENDPOINT &&
    process.env.R2_BUCKET_NAME
);

const hasAWSCredentials = !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION &&
    process.env.AWS_S3_BUCKET_NAME &&
    process.env.AWS_ACCESS_KEY_ID !== 'your_access_key_here'
);

const hasCredentials = hasR2Credentials || hasAWSCredentials;

console.log('--- Storage Config Debug ---');
if (hasR2Credentials) {
    console.log('✅ Using Cloudflare R2');
    console.log('R2_BUCKET_NAME:', process.env.R2_BUCKET_NAME);
    console.log('R2_ENDPOINT:', process.env.R2_ENDPOINT);
} else if (hasAWSCredentials) {
    console.log('✅ Using AWS S3');
    console.log('AWS_S3_BUCKET_NAME:', process.env.AWS_S3_BUCKET_NAME);
} else {
    console.warn('⚠️ No cloud storage credentials configured. Falling back to local storage.');
}
console.log('---------------------------');

let s3 = null;
let resumeStorage = null;
let offerLetterStorage = null;
let profilePhotoStorage = null;
let clientLogoStorage = null;

if (hasCredentials) {
    // Configure S3 client (works for both AWS and R2)
    const s3Config = {
        accessKeyId: hasR2Credentials ? process.env.R2_ACCESS_KEY_ID : process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: hasR2Credentials ? process.env.R2_SECRET_ACCESS_KEY : process.env.AWS_SECRET_ACCESS_KEY,
        signatureVersion: 'v4',
    };

    if (hasR2Credentials) {
        try {
            const endpointUrl = new URL(process.env.R2_ENDPOINT);
            s3Config.endpoint = `${endpointUrl.protocol}//${endpointUrl.hostname}`;
        } catch (e) {
            s3Config.endpoint = process.env.R2_ENDPOINT;
        }
    } else {
        s3Config.region = process.env.AWS_REGION;
    }

    s3 = new AWS.S3(s3Config);

    const bucketName = hasR2Credentials ? process.env.R2_BUCKET_NAME : process.env.AWS_S3_BUCKET_NAME;

    // S3/R2 Storage for Resumes
    resumeStorage = multerS3({
        s3: s3,
        bucket: bucketName,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: function (req, file, cb) {
            const fileName = `resumes/${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
            cb(null, fileName);
        }
    });

    // S3/R2 Storage for Offer Letters
    offerLetterStorage = multerS3({
        s3: s3,
        bucket: bucketName,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: function (req, file, cb) {
            const fileName = `offers/offer-${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
            cb(null, fileName);
        }
    });

    // S3/R2 Storage for Profile Photos
    profilePhotoStorage = multerS3({
        s3: s3,
        bucket: bucketName,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: function (req, file, cb) {
            const fileName = `photos/photo-${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
            cb(null, fileName);
        }
    });

    // S3/R2 Storage for Client Logos
    clientLogoStorage = multerS3({
        s3: s3,
        bucket: bucketName,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: function (req, file, cb) {
            const fileName = `logos/logo-${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
            cb(null, fileName);
        }
    });

    console.log(`✅ ${hasR2Credentials ? 'Cloudflare R2' : 'AWS S3'} configured successfully`);
} else {
    // Fallback to local storage
    resumeStorage = multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = "uploads/resumes/";
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`);
        }
    });

    offerLetterStorage = multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = "uploads/offers/";
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            cb(null, `offer-${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`);
        }
    });

    profilePhotoStorage = multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = "uploads/photos/";
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            cb(null, `photo-${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`);
        }
    });

    clientLogoStorage = multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = "uploads/logos/";
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            cb(null, `logo-${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`);
        }
    });
}


/**
 * Centralized helper to delete a file from Cloud Storage (R2/S3) or Local
 * @param {string} fileUrl - The URL or path of the file to delete
 */
const deleteFile = async (fileUrl) => {
    if (!fileUrl) return;

    // Check if it's a Cloud Storage URL (S3 or R2)
    const isCloudUrl = fileUrl.includes('amazonaws.com') || 
                       (process.env.R2_ENDPOINT && fileUrl.includes(new URL(process.env.R2_ENDPOINT).hostname)) ||
                       fileUrl.includes('r2.cloudflarestorage.com') ||
                       (process.env.R2_PUBLIC_URL && fileUrl.includes(process.env.R2_PUBLIC_URL));

    if (isCloudUrl && s3) {
        try {
            const urlObj = new URL(fileUrl);
            let key = decodeURIComponent(urlObj.pathname.substring(1));

            // Handle Path-Style URLs for S3
            const s3BucketName = process.env.AWS_S3_BUCKET_NAME;
            if (urlObj.hostname.startsWith('s3.') && s3BucketName && key.startsWith(s3BucketName + '/')) {
                key = key.substring(s3BucketName.length + 1);
            }

            // Handle R2 custom domains/public URLs
            const r2BucketName = process.env.R2_BUCKET_NAME;
            if (process.env.R2_PUBLIC_URL && fileUrl.includes(process.env.R2_PUBLIC_URL)) {
                const publicUrlObj = new URL(process.env.R2_PUBLIC_URL);
                if (key.startsWith(publicUrlObj.pathname.substring(1))) {
                    // key is already correct or needs slight adjustment if public URL has a path
                }
            }

            if (key) {
                const bucket = hasR2Credentials ? process.env.R2_BUCKET_NAME : process.env.AWS_S3_BUCKET_NAME;
                await s3.deleteObject({
                    Bucket: bucket,
                    Key: key
                }).promise();
                console.log(`🗑️ Deleted from cloud storage: ${key}`);
            }
        } catch (error) {
            console.error("❌ Error deleting from cloud storage:", error);
        }
    } else if (!fileUrl.startsWith('http')) {
        // Local file
        const localPath = path.isAbsolute(fileUrl) ? fileUrl : path.resolve(fileUrl);
        if (fs.existsSync(localPath)) {
            try {
                fs.unlinkSync(localPath);
                console.log(`🗑️ Deleted local file: ${localPath}`);
            } catch (err) {
                console.error("❌ Error deleting local file:", err);
            }
        }
    }
};

// Helper to generate Signed URL
const getSignedUrl = (fileUrl) => {
    if (!fileUrl || !s3) return fileUrl;

    const isCloudUrl = fileUrl.includes('amazonaws.com') || 
                       (process.env.R2_ENDPOINT && fileUrl.includes(new URL(process.env.R2_ENDPOINT).hostname)) ||
                       fileUrl.includes('r2.cloudflarestorage.com') ||
                       (process.env.R2_PUBLIC_URL && fileUrl.includes(process.env.R2_PUBLIC_URL));

    if (isCloudUrl) {
        try {
            const urlObj = new URL(fileUrl);
            let key = decodeURIComponent(urlObj.pathname.substring(1));

            const s3BucketName = process.env.AWS_S3_BUCKET_NAME;
            if (urlObj.hostname.startsWith('s3.') && s3BucketName && key.startsWith(s3BucketName + '/')) {
                key = key.substring(s3BucketName.length + 1);
            }

            if (key) {
                const bucket = hasR2Credentials ? process.env.R2_BUCKET_NAME : process.env.AWS_S3_BUCKET_NAME;
                const signedUrl = s3.getSignedUrl('getObject', {
                    Bucket: bucket,
                    Key: key,
                    Expires: 60 * 60 // 1 hour
                });
                return signedUrl;
            }
        } catch (error) {
            console.error("Error generating signed URL:", error);
            return fileUrl;
        }
    }

    return fileUrl;
};

module.exports = {
    s3,
    resumeStorage,
    offerLetterStorage,
    profilePhotoStorage,
    clientLogoStorage,
    hasAWSCredentials,
    hasR2Credentials,
    hasCredentials,
    getSignedUrl,
    deleteFile
};

