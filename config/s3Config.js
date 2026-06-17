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
            s3Config.s3ForcePathStyle = true; // Required for R2 custom endpoints
        } catch (e) {
            s3Config.endpoint = process.env.R2_ENDPOINT;
            s3Config.s3ForcePathStyle = true;
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
 * Extract the correct bucket and key from a file URL.
 * When R2 is active, always use the R2 bucket name (never the old S3 bucket name).
 */
const extractBucketAndKey = (fileUrl) => {
    const r2BucketName = process.env.R2_BUCKET_NAME;
    const s3BucketName = process.env.AWS_S3_BUCKET_NAME;

    const urlObj = new URL(fileUrl);
    const hostname = urlObj.hostname;
    let pathname = decodeURIComponent(urlObj.pathname);
    if (pathname.startsWith('/')) pathname = pathname.substring(1);

    // Default: use the configured active bucket
    let bucket = hasR2Credentials ? r2BucketName : s3BucketName;
    let key = pathname;

    // Virtual-Hosted Style: bucket.s3.region.amazonaws.com/key
    const vhostMatch = hostname.match(/^(.+)\.s3[.-][^.]+\.amazonaws\.com$/);
    if (vhostMatch) {
        // If R2 is active, ignore the S3 bucket name in the URL and use R2 bucket
        if (!hasR2Credentials) {
            bucket = vhostMatch[1];
        }
        key = pathname;
    }
    // Path-Style: s3.amazonaws.com/bucket/key  OR  account.r2.cloudflarestorage.com/bucket/key
    else if (
        hostname.includes('s3.amazonaws.com') ||
        hostname.includes('r2.cloudflarestorage.com') ||
        hostname.endsWith('.r2.dev')
    ) {
        const parts = pathname.split('/');
        if (parts.length > 1) {
            if (!hasR2Credentials) {
                // Pure S3 path-style: first segment is bucket name
                bucket = parts[0];
                key = parts.slice(1).join('/');
            } else {
                // R2 path-style: first segment may or may not be the bucket name
                if (parts[0] === r2BucketName) {
                    key = parts.slice(1).join('/');
                } else {
                    // Old S3 bucket name in path — ignore it, use the whole path as key
                    // OR the path already has the correct key without bucket prefix
                    key = pathname;
                }
            }
        }
    }

    return { bucket, key };
};

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
            const { bucket, key } = extractBucketAndKey(fileUrl);

            if (key && bucket) {
                await s3.deleteObject({
                    Bucket: bucket,
                    Key: key
                }).promise();
                console.log(`🗑️ Deleted from cloud storage: ${key} (Bucket: ${bucket})`);
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

/**
 * Generate a pre-signed URL for accessing a file.
 * Handles:
 *  1. Old AWS S3 URLs  → re-signed against active Cloudflare R2 bucket
 *  2. R2 URLs          → re-signed normally
 *  3. Local-style paths that were migrated to cloud → signed against active bucket
 */
const getSignedUrl = (fileUrl) => {
    if (!fileUrl || !s3) return fileUrl;

    const isCloudUrl = fileUrl.includes('amazonaws.com') ||
                       (process.env.R2_ENDPOINT && fileUrl.includes(new URL(process.env.R2_ENDPOINT).hostname)) ||
                       fileUrl.includes('r2.cloudflarestorage.com') ||
                       (process.env.R2_PUBLIC_URL && fileUrl.includes(process.env.R2_PUBLIC_URL));

    if (isCloudUrl) {
        try {
            const { bucket, key } = extractBucketAndKey(fileUrl);
            console.log(`🔗 Generating signed URL for Bucket: ${bucket}, Key: ${key}`);

            if (key && bucket) {
                let filename = key.split('/').pop() || 'resume';
                filename = filename.replace(/^\d+-/, ''); // Remove leading timestamps

                const params = {
                    Bucket: bucket,
                    Key: key,
                    Expires: 60 * 60 // 1 hour
                };

                const ext = filename.split('.').pop().toLowerCase();
                let mimeType = null;
                if (ext === 'pdf') {
                    mimeType = 'application/pdf';
                } else if (ext === 'docx') {
                    mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                } else if (ext === 'doc') {
                    mimeType = 'application/msword';
                }

                if (mimeType) {
                    params.ResponseContentType = mimeType;
                }
                params.ResponseContentDisposition = `inline; filename="${filename}"`;

                return s3.getSignedUrl('getObject', params);
            }
        } catch (error) {
            console.error("Error generating signed URL:", error);
            return fileUrl;
        }
    }

    // Handle local-looking paths that have been migrated to cloud storage
    if (!isCloudUrl && hasCredentials && fileUrl && !fileUrl.startsWith('http')) {
        const knownPrefixes = ['logos/', 'photos/', 'resumes/', 'offers/', 'uploads/'];
        if (knownPrefixes.some(prefix => fileUrl.startsWith(prefix))) {
            try {
                const bucket = hasR2Credentials ? process.env.R2_BUCKET_NAME : process.env.AWS_S3_BUCKET_NAME;
                if (bucket) {
                    console.log(`🔗 Signing migrated local path for Bucket: ${bucket}, Key: ${fileUrl}`);

                    let filename = fileUrl.split('/').pop() || 'resume';
                    filename = filename.replace(/^\d+-/, '');

                    const params = {
                        Bucket: bucket,
                        Key: fileUrl,
                        Expires: 60 * 60 // 1 hour
                    };

                    const ext = filename.split('.').pop().toLowerCase();
                    let mimeType = null;
                    if (ext === 'pdf') {
                        mimeType = 'application/pdf';
                    } else if (ext === 'docx') {
                        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                    } else if (ext === 'doc') {
                        mimeType = 'application/msword';
                    }

                    if (mimeType) {
                        params.ResponseContentType = mimeType;
                    }
                    params.ResponseContentDisposition = `inline; filename="${filename}"`;

                    return s3.getSignedUrl('getObject', params);
                }
            } catch (error) {
                console.error("Error signing migrated local path:", error);
            }
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
    deleteFile,
    extractBucketAndKey
};
