const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const dotenv = require('dotenv');

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const clientLogoStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'ats/clients',
        allowed_formats: ['jpg', 'png', 'jpeg', 'gif'],
        resource_type: 'auto',
        public_id: (req, file) => `logo-${Date.now()}-${file.originalname.split('.')[0]}`
    }
});

const profilePhotoStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'ats/profiles',
        allowed_formats: ['jpg', 'png', 'jpeg', 'gif'],
        resource_type: 'auto',
        public_id: (req, file) => `profile-${Date.now()}-${file.originalname.split('.')[0]}`
    }
});

const resumeStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'ats/resumes',
        allowed_formats: ['pdf', 'doc', 'docx'],
        resource_type: 'auto',
        public_id: (req, file) => `resume-${Date.now()}-${file.originalname.split('.')[0]}`
    }
});

const offerLetterStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'ats/offers',
        allowed_formats: ['pdf', 'doc', 'docx', 'jpg', 'png', 'jpeg'],
        resource_type: 'auto',
        public_id: (req, file) => `offer-${Date.now()}-${file.originalname.split('.')[0]}`
    }
});

module.exports = {
    cloudinary,
    clientLogoStorage,
    profilePhotoStorage,
    resumeStorage,
    offerLetterStorage
};
