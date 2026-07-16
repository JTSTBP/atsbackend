const nodemailer = require("nodemailer");

const clean = (value) => (typeof value === "string" ? value.trim() : value);

const normalizePassword = (value) => {
    const password = clean(value);
    if (!password) return password;
    return process.env.SMTP_KEEP_PASSWORD_SPACES === "true"
        ? password
        : password.replace(/\s+/g, "");
};

const getDefaultEmailConfig = () => {
    const user = clean(process.env.SMTP_USER || process.env.EMAIL_ID || process.env.EMAIL_USER);
    const pass = normalizePassword(process.env.SMTP_PASS || process.env.APP_PASSWORD || process.env.EMAIL_PASS);
    const host = clean(process.env.SMTP_HOST) || "smtp.gmail.com";
    const port = Number(process.env.SMTP_PORT || 465);
    const secure = process.env.SMTP_SECURE
        ? process.env.SMTP_SECURE === "true"
        : port === 465;

    return { user, pass, host, port, secure };
};

const createEmailTransporter = ({ user, pass } = {}) => {
    const config = getDefaultEmailConfig();
    const authUser = clean(user) || config.user;
    const authPass = normalizePassword(pass) || config.pass;

    if (!authUser || !authPass) {
        throw new Error("Email SMTP credentials are not configured. Set SMTP_USER/SMTP_PASS or EMAIL_ID/APP_PASSWORD.");
    }

    return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: authUser,
            pass: authPass,
        },
        tls: {
            rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED === "false" ? false : true,
        },
    });
};

const sendMail = async ({ fromName = "Jobs Territory", from, to, cc, bcc, replyTo, subject, text, html, attachments, auth } = {}) => {
    const config = getDefaultEmailConfig();
    const senderEmail = clean(from || auth?.user || config.user);

    if (!to) {
        throw new Error("Email recipient is required.");
    }

    const transporter = createEmailTransporter(auth);
    const mailOptions = {
        from: fromName ? `"${fromName}" <${senderEmail}>` : senderEmail,
        to,
        cc,
        bcc,
        replyTo: replyTo || clean(process.env.SENDER_ID),
        subject,
        text,
        html,
        attachments,
    };

    Object.keys(mailOptions).forEach((key) => {
        if (mailOptions[key] === undefined || mailOptions[key] === "") {
            delete mailOptions[key];
        }
    });

    return transporter.sendMail(mailOptions);
};

module.exports = {
    createEmailTransporter,
    sendMail,
};
