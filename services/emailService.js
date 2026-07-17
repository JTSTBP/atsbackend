const crypto = require("crypto");
const dns = require("dns");
const fs = require("fs");
const net = require("net");
const nodemailer = require("nodemailer");

const EMAIL_SERVICE_VERSION = "provider-email-v3-2026-07-17";

if (typeof dns.setDefaultResultOrder === "function") {
    dns.setDefaultResultOrder("ipv4first");
}

const clean = (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
};

const isValidEmail = (value) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value || "").trim());

const isValidNamedEmail = (value) => /^.+\s<[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>$/.test(String(value || "").trim());

const formatNamedEmail = (name, email) => {
    const cleanName = clean(name) || "Jobs Territory";
    const cleanEmail = clean(email);
    return `"${String(cleanName).replace(/"/g, "")}" <${cleanEmail}>`;
};

const normalizePassword = (value) => {
    const password = clean(value);
    if (!password) return password;
    return process.env.SMTP_KEEP_PASSWORD_SPACES === "true"
        ? password
        : password.replace(/\s+/g, "");
};

const getNumberEnv = (key, fallback) => {
    const value = Number(process.env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

const getDefaultEmailConfig = () => {
    const user = clean(process.env.SMTP_USER || process.env.EMAIL_ID || process.env.EMAIL_USER);
    const pass = normalizePassword(process.env.SMTP_PASS || process.env.APP_PASSWORD || process.env.EMAIL_PASS);
    const host = clean(process.env.SMTP_HOST) || "smtp.gmail.com";
    const rejectUnauthorized = process.env.SMTP_REJECT_UNAUTHORIZED === "false" ? false : true;

    return {
        user,
        pass,
        host,
        rejectUnauthorized,
        connectionTimeout: getNumberEnv("SMTP_CONNECTION_TIMEOUT_MS", 8000),
        greetingTimeout: getNumberEnv("SMTP_GREETING_TIMEOUT_MS", 8000),
        socketTimeout: getNumberEnv("SMTP_SOCKET_TIMEOUT_MS", 15000),
    };
};

const getEmailProvider = () => clean(process.env.EMAIL_PROVIDER || process.env.MAIL_PROVIDER || "smtp").toLowerCase();

const assertValidEmailProvider = (traceId) => {
    const provider = getEmailProvider();
    if (!["resend", "smtp"].includes(provider)) {
        const error = new Error(`Invalid email provider "${provider}". Use EMAIL_PROVIDER=resend or EMAIL_PROVIDER=smtp.`);
        error.code = "INVALID_EMAIL_PROVIDER";
        error.traceId = traceId;
        throw error;
    }
    return provider;
};

const normalizeEmailList = (value) => {
    if (!value) return undefined;
    if (Array.isArray(value)) return value.filter(Boolean).map(item => String(item).trim()).filter(Boolean);
    return String(value)
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
};

const getResendFromAddress = ({ fromName, fallbackEmail }) => {
    const configured = clean(process.env.RESEND_FROM_EMAIL || process.env.MAIL_FROM || process.env.SMTP_FROM);
    if (configured) {
        if (isValidNamedEmail(configured)) return configured;
        if (isValidEmail(configured)) return formatNamedEmail(fromName, configured);
        return configured;
    }
    const domain = clean(process.env.RESEND_FROM_DOMAIN);
    if (domain) {
        return formatNamedEmail(fromName, `noreply@${domain}`);
    }
    return isValidEmail(fallbackEmail) ? formatNamedEmail(fromName, fallbackEmail) : fallbackEmail;
};

const convertAttachmentsForResend = async (attachments = []) => {
    if (!Array.isArray(attachments) || attachments.length === 0) return undefined;

    const converted = [];
    for (const attachment of attachments) {
        if (!attachment) continue;
        const filename = attachment.filename || attachment.name || "attachment";
        let content = attachment.content;

        if (!content && attachment.path) {
            content = await fs.promises.readFile(attachment.path);
        }

        if (!content) continue;

        converted.push({
            filename,
            content: Buffer.isBuffer(content)
                ? content.toString("base64")
                : Buffer.from(String(content)).toString("base64"),
        });
    }

    return converted.length ? converted : undefined;
};

const sendMailWithResend = async ({ fromName, from, to, cc, bcc, replyTo, subject, text, html, attachments, traceId }) => {
    const apiKey = clean(process.env.RESEND_API_KEY);
    if (!apiKey) {
        const error = new Error("Resend API key is not configured. Set RESEND_API_KEY.");
        error.code = "RESEND_API_KEY_MISSING";
        error.traceId = traceId;
        throw error;
    }

    if (!clean(process.env.RESEND_FROM_EMAIL) && !clean(process.env.RESEND_FROM_DOMAIN) && !from) {
        const error = new Error("Resend sender is not configured. Set RESEND_FROM_EMAIL.");
        error.code = "RESEND_FROM_EMAIL_MISSING";
        error.traceId = traceId;
        throw error;
    }

    if (typeof fetch !== "function") {
        const error = new Error("Global fetch is unavailable in this Node runtime. Use Node 18+ or add a fetch polyfill.");
        error.code = "EMAIL_PROVIDER_NOT_CONFIGURED";
        error.traceId = traceId;
        throw error;
    }

    const resendFrom = getResendFromAddress({ fromName, fallbackEmail: from });
    if (!isValidEmail(resendFrom) && !isValidNamedEmail(resendFrom)) {
        const error = new Error("Invalid Resend sender. Set RESEND_FROM_EMAIL as email@example.com or Name <email@example.com>.");
        error.code = "RESEND_FROM_EMAIL_INVALID";
        error.traceId = traceId;
        error.providerResponse = { from: resendFrom };
        throw error;
    }

    const payload = {
        from: resendFrom,
        to: normalizeEmailList(to),
        cc: normalizeEmailList(cc),
        bcc: normalizeEmailList(bcc),
        reply_to: replyTo || from,
        subject,
        html,
        text,
        attachments: await convertAttachmentsForResend(attachments),
    };

    Object.keys(payload).forEach((key) => {
        if (payload[key] === undefined || payload[key] === "" || (Array.isArray(payload[key]) && payload[key].length === 0)) {
            delete payload[key];
        }
    });

    console.log(`[EMAIL ${traceId}] Sending via Resend HTTPS API`, {
        from: payload.from,
        replyTo: payload.reply_to,
        toCount: payload.to?.length || 0,
        ccCount: payload.cc?.length || 0,
        hasAttachments: Boolean(payload.attachments?.length),
    });

    const startedAt = Date.now();
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data?.message || data?.error || `Resend API failed with status ${response.status}`);
        error.code = response.status === 401 || response.status === 403 ? "EMAIL_PROVIDER_AUTH_FAILED" : "EMAIL_PROVIDER_SEND_FAILED";
        error.traceId = traceId;
        error.providerResponse = data;
        throw error;
    }

    console.log(`[EMAIL ${traceId}] Resend send completed in ${Date.now() - startedAt}ms`, {
        id: data?.id || null,
    });

    return {
        traceId,
        provider: "resend",
        messageId: data?.id || null,
    };
};

const getFallbackModes = () => {
    const configuredModes = clean(process.env.SMTP_FALLBACK_MODES);
    if (configuredModes) {
        return [...new Set(configuredModes.split(",").map((mode) => mode.trim()).filter(Boolean))];
    }

    const primaryMode = clean(process.env.SMTP_TRANSPORT_MODE) || "direct-ipv4-587";
    const defaults = [
        "direct-ipv4-587",
        "ipv4-lookup-587",
        "ssl-465",
        "default-587",
        "custom-socket-587",
        "gmail-service",
    ];
    return [primaryMode, ...defaults.filter((mode) => mode !== primaryMode)];
};

const classifySmtpError = (error) => {
    const message = `${error?.message || ""} ${error?.response || ""}`.toLowerCase();
    const code = String(error?.code || "").toLowerCase();
    const responseCode = Number(error?.responseCode);

    if (responseCode === 535 || message.includes("invalid login") || message.includes("application-specific password") || message.includes("username and password not accepted")) {
        return "SMTP_AUTH_FAILED";
    }

    if (responseCode === 454 || responseCode === 452 || message.includes("daily") || message.includes("quota") || message.includes("rate limit") || message.includes("too many")) {
        return "GMAIL_DAILY_LIMIT_EXCEEDED";
    }

    if (
        code.includes("etimedout") ||
        code.includes("econnrefused") ||
        code.includes("econnreset") ||
        code.includes("enetunreach") ||
        code.includes("ehostunreach") ||
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("greeting never received")
    ) {
        return "SMTP_CONNECTION_FAILED";
    }

    return "SMTP_SEND_FAILED";
};

const resolveGmailIpv4 = async (host) => {
    const addresses = await dns.promises.resolve4(host);
    if (!addresses.length) {
        throw new Error(`No IPv4 addresses found for ${host}`);
    }
    return addresses[0];
};

const lookupIpv4Only = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, family: 4 }, callback);
};

const getGmailIpv4Socket = (options, callback) => {
    const config = getDefaultEmailConfig();
    dns.resolve4(config.host, (dnsError, addresses) => {
        if (dnsError) return callback(dnsError);
        const address = addresses && addresses[0];
        if (!address) return callback(new Error(`No IPv4 address found for ${config.host}`));

        const socket = net.connect({
            host: address,
            port: options.port || 587,
            family: 4,
            timeout: config.connectionTimeout,
        });

        socket.once("connect", () => callback(null, { connection: socket }));
        socket.once("timeout", () => {
            socket.destroy(new Error(`SMTP socket timed out after ${config.connectionTimeout}ms`));
        });
        socket.once("error", callback);
    });
};

const tcpConnectTest = ({ host, port, family = 4, timeoutMs } = {}) => new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.connect({
        host,
        port,
        family,
        timeout: timeoutMs || getDefaultEmailConfig().connectionTimeout,
    });
    const finish = result => {
        socket.removeAllListeners();
        socket.destroy();
        resolve({
            ...result,
            host,
            port,
            family,
            durationMs: Date.now() - startedAt,
        });
    };
    socket.once("connect", () => finish({ ok: true }));
    socket.once("timeout", () => finish({ ok: false, code: "TIMEOUT", message: `TCP connection timed out` }));
    socket.once("error", error => finish({ ok: false, code: error.code, message: error.message }));
});

const getEmailDiagnostics = async () => {
    const config = getDefaultEmailConfig();
    const diagnostics = {
        envStatus: {
            SMTP_HOST: Boolean(process.env.SMTP_HOST),
            SMTP_USER: Boolean(process.env.SMTP_USER),
            SMTP_PASS: Boolean(process.env.SMTP_PASS),
            EMAIL_ID: Boolean(process.env.EMAIL_ID),
            EMAIL_USER: Boolean(process.env.EMAIL_USER),
            APP_PASSWORD: Boolean(process.env.APP_PASSWORD),
            EMAIL_PASS: Boolean(process.env.EMAIL_PASS),
            SMTP_TRANSPORT_MODE: process.env.SMTP_TRANSPORT_MODE || null,
            SMTP_FALLBACK_MODES: process.env.SMTP_FALLBACK_MODES || null,
            resolvedHost: config.host,
            hasResolvedUser: Boolean(config.user),
            hasResolvedPassword: Boolean(config.pass),
        },
        dns: {},
        tcpTests: [],
        controlTcpTests: [],
        fallbackModes: getFallbackModes(),
    };

    try {
        diagnostics.dns.lookupAll = await dns.promises.lookup(config.host, { all: true });
    } catch (error) {
        diagnostics.dns.lookupAllError = error.message;
    }

    try {
        diagnostics.dns.resolve4 = await dns.promises.resolve4(config.host);
    } catch (error) {
        diagnostics.dns.resolve4Error = error.message;
    }

    try {
        diagnostics.dns.resolve6 = await dns.promises.resolve6(config.host);
    } catch (error) {
        diagnostics.dns.resolve6Error = error.message;
    }

    diagnostics.tcpTests.push(await tcpConnectTest({ host: config.host, port: 587, family: 0 }));
    diagnostics.tcpTests.push(await tcpConnectTest({ host: config.host, port: 587, family: 4 }));
    diagnostics.tcpTests.push(await tcpConnectTest({ host: config.host, port: 465, family: 4 }));

    const firstIpv4 = diagnostics.dns.resolve4?.[0];
    if (firstIpv4) {
        diagnostics.tcpTests.push(await tcpConnectTest({ host: firstIpv4, port: 587, family: 4 }));
        diagnostics.tcpTests.push(await tcpConnectTest({ host: firstIpv4, port: 465, family: 4 }));
    }

    diagnostics.controlTcpTests.push(await tcpConnectTest({ host: "www.google.com", port: 443, family: 4 }));
    diagnostics.controlTcpTests.push(await tcpConnectTest({ host: "gmail.googleapis.com", port: 443, family: 4 }));

    const smtpTcpReachable = diagnostics.tcpTests.some(test => test.ok);
    const httpsTcpReachable = diagnostics.controlTcpTests.some(test => test.ok);
    diagnostics.networkConclusion = smtpTcpReachable
        ? "At least one Gmail SMTP TCP connection succeeded."
        : httpsTcpReachable
            ? "HTTPS outbound connectivity works, but Gmail SMTP ports 587/465 are unreachable from this deployment."
            : "Both Gmail SMTP and HTTPS control connections failed from this deployment.";

    return diagnostics;
};

const buildTransportOptions = async (mode, auth) => {
    const config = getDefaultEmailConfig();
    const common = {
        auth,
        connectionTimeout: config.connectionTimeout,
        greetingTimeout: config.greetingTimeout,
        socketTimeout: config.socketTimeout,
        tls: {
            servername: config.host,
            rejectUnauthorized: config.rejectUnauthorized,
        },
    };

    if (mode === "direct-ipv4-587") {
        const ip = await resolveGmailIpv4(config.host);
        return {
            ...common,
            host: ip,
            port: 587,
            secure: false,
            requireTLS: true,
            lookup: lookupIpv4Only,
            name: config.host,
            tls: { ...common.tls, servername: config.host },
            _resolvedHost: ip,
        };
    }

    if (mode === "direct-ipv4-465") {
        const ip = await resolveGmailIpv4(config.host);
        return {
            ...common,
            host: ip,
            port: 465,
            secure: true,
            lookup: lookupIpv4Only,
            name: config.host,
            tls: { ...common.tls, servername: config.host },
            _resolvedHost: ip,
        };
    }

    if (mode === "ipv4-lookup-587") {
        return {
            ...common,
            host: config.host,
            port: 587,
            secure: false,
            requireTLS: true,
            family: 4,
            lookup: lookupIpv4Only,
        };
    }

    if (mode === "ipv4-lookup-465") {
        return {
            ...common,
            host: config.host,
            port: 465,
            secure: true,
            family: 4,
            lookup: lookupIpv4Only,
        };
    }

    if (mode === "ssl-465") {
        return {
            ...common,
            host: config.host,
            port: 465,
            secure: true,
            family: 4,
            lookup: lookupIpv4Only,
        };
    }

    if (mode === "gmail-service") {
        return {
            ...common,
            service: "gmail",
        };
    }

    if (mode === "default-587") {
        return {
            ...common,
            host: config.host,
            port: 587,
            secure: false,
            requireTLS: true,
            tls: { ...common.tls, servername: config.host },
        };
    }

    if (mode === "custom-socket-587") {
        return {
            ...common,
            host: config.host,
            port: 587,
            secure: false,
            requireTLS: true,
            family: 4,
            lookup: lookupIpv4Only,
            getSocket: getGmailIpv4Socket,
            dnsTimeout: config.connectionTimeout,
            pool: false,
        };
    }

    const customPort = Number(process.env.SMTP_PORT || 587);
    return {
        ...common,
        host: config.host,
        port: customPort,
        secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : customPort === 465,
    };
};

const createEmailTransporter = async ({ user, pass, mode } = {}) => {
    const config = getDefaultEmailConfig();
    const authUser = clean(user) || config.user;
    const authPass = normalizePassword(pass) || config.pass;

    if (!authUser || !authPass) {
        const error = new Error("Email SMTP credentials are not configured. Set SMTP_USER/SMTP_PASS or EMAIL_ID/APP_PASSWORD.");
        error.code = "SMTP_AUTH_FAILED";
        throw error;
    }

    const selectedMode = mode || clean(process.env.SMTP_TRANSPORT_MODE) || "direct-ipv4-587";
    const options = await buildTransportOptions(selectedMode, {
        user: authUser,
        pass: authPass,
    });

    return nodemailer.createTransport(options);
};

const runSmtpAttempt = async ({ mode, auth, mailOptions, verifyOnly, traceId }) => {
    const startedAt = Date.now();
    const attempt = {
        mode,
        host: null,
        port: null,
        secure: null,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: null,
        success: false,
        errorCode: null,
        errorMessage: null,
    };

    try {
        const options = await buildTransportOptions(mode, auth);
        attempt.host = options._resolvedHost || options.host;
        attempt.port = options.port;
        attempt.secure = !!options.secure;
        attempt.hasLookup = !!options.lookup;
        attempt.hasGetSocket = !!options.getSocket;
        console.log(`[SMTP ${traceId}] Starting attempt "${mode}" via ${attempt.host}:${attempt.port} secure=${attempt.secure} lookup=${attempt.hasLookup} getSocket=${attempt.hasGetSocket}`);

        const transporter = nodemailer.createTransport(options);
        if (verifyOnly) {
            await transporter.verify();
        } else {
            await transporter.sendMail(mailOptions);
        }

        attempt.durationMs = Date.now() - startedAt;
        attempt.success = true;
        console.log(`[SMTP ${traceId}] Attempt "${mode}" succeeded in ${attempt.durationMs}ms`);
        return { success: true, attempt };
    } catch (error) {
        attempt.durationMs = Date.now() - startedAt;
        attempt.errorCode = classifySmtpError(error);
        attempt.errorMessage = error.message;
        console.error(`[SMTP ${traceId}] Attempt "${mode}" failed in ${attempt.durationMs}ms: ${attempt.errorCode} - ${error.message}`);
        return { success: false, attempt, error };
    }
};

const buildSmtpFailure = ({ traceId, attempts, lastError, diagnostics }) => {
    const code = attempts.some((attempt) => attempt.errorCode === "SMTP_AUTH_FAILED")
        ? "SMTP_AUTH_FAILED"
        : attempts.some((attempt) => attempt.errorCode === "GMAIL_DAILY_LIMIT_EXCEEDED")
            ? "GMAIL_DAILY_LIMIT_EXCEEDED"
            : attempts.every((attempt) => attempt.errorCode === "SMTP_CONNECTION_FAILED")
                ? "SMTP_CONNECTION_FAILED"
                : classifySmtpError(lastError);

    const error = new Error(
        code === "SMTP_CONNECTION_FAILED"
            ? "Unable to connect to Gmail SMTP from this deployment."
            : lastError?.message || "Email sending failed."
    );
    error.code = code;
    error.traceId = traceId;
    error.smtpAttempts = attempts;
    error.diagnostics = diagnostics;
    error.emailServiceVersion = EMAIL_SERVICE_VERSION;
    return error;
};

const sendMail = async ({ fromName = "Jobs Territory", from, to, cc, bcc, replyTo, subject, text, html, attachments, auth } = {}) => {
    const config = getDefaultEmailConfig();
    const senderEmail = clean(from || auth?.user || config.user);
    const authUser = clean(auth?.user) || config.user;
    const authPass = normalizePassword(auth?.pass) || config.pass;
    const traceId = crypto.randomBytes(6).toString("hex");
    const provider = assertValidEmailProvider(traceId);

    if (!to) {
        throw new Error("Email recipient is required.");
    }

    if (provider === "resend") {
        return sendMailWithResend({
            fromName,
            from: senderEmail,
            to,
            cc,
            bcc,
            replyTo: replyTo || clean(process.env.SENDER_ID) || senderEmail,
            subject,
            text,
            html,
            attachments,
            traceId,
        });
    }

    if (!authUser || !authPass) {
        const error = new Error("Email SMTP credentials are not configured. Set SMTP_USER/SMTP_PASS or EMAIL_ID/APP_PASSWORD.");
        error.code = "SMTP_AUTH_FAILED";
        error.traceId = traceId;
        error.smtpAttempts = [];
        throw error;
    }

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

    const attempts = [];
    let lastError = null;

    for (const mode of getFallbackModes()) {
        const result = await runSmtpAttempt({
            mode,
            auth: { user: authUser, pass: authPass },
            mailOptions,
            verifyOnly: false,
            traceId,
        });
        attempts.push(result.attempt);

        if (result.success) {
            return { traceId, smtpAttempts: attempts };
        }

        lastError = result.error;

        if (result.attempt.errorCode === "SMTP_AUTH_FAILED" || result.attempt.errorCode === "GMAIL_DAILY_LIMIT_EXCEEDED") {
            break;
        }
    }

    const connectionOnlyFailure = attempts.length > 0 && attempts.every((attempt) => attempt.errorCode === "SMTP_CONNECTION_FAILED");
    const diagnostics = connectionOnlyFailure
        ? await getEmailDiagnostics().catch(error => ({ error: error.message }))
        : undefined;

    throw buildSmtpFailure({ traceId, attempts, lastError, diagnostics });
};

const verifyEmailTransport = async (auth = {}) => {
    const config = getDefaultEmailConfig();
    const authUser = clean(auth.user) || config.user;
    const authPass = normalizePassword(auth.pass) || config.pass;
    const traceId = crypto.randomBytes(6).toString("hex");
    const attempts = [];
    let lastError = null;

    for (const mode of getFallbackModes()) {
        const result = await runSmtpAttempt({
            mode,
            auth: { user: authUser, pass: authPass },
            mailOptions: null,
            verifyOnly: true,
            traceId,
        });
        attempts.push(result.attempt);

        if (result.success) {
            return { traceId, smtpAttempts: attempts };
        }

        lastError = result.error;
    }

    const diagnostics = await getEmailDiagnostics().catch(error => ({ error: error.message }));
    throw buildSmtpFailure({ traceId, attempts, lastError, diagnostics });
};

const sendMailWithConfiguredProvider = sendMail;

const formatEmailErrorResponse = (error) => ({
    code: error.code || classifySmtpError(error),
    traceId: error.traceId,
    emailServiceVersion: error.emailServiceVersion || EMAIL_SERVICE_VERSION,
    provider: getEmailProvider(),
    smtpAttempts: error.smtpAttempts,
    diagnostics: error.diagnostics,
    providerResponse: error.providerResponse,
    message: error.message || "Email sending failed.",
});

module.exports = {
    EMAIL_SERVICE_VERSION,
    createEmailTransporter,
    sendMail,
    sendMailWithConfiguredProvider,
    verifyEmailTransport,
    getEmailDiagnostics,
    getEmailProvider,
    formatEmailErrorResponse,
};
