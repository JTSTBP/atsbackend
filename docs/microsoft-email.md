# Microsoft follow-up email setup

The Profile screen and Follow-ups → Emails screen contain **Connect Outlook / Microsoft 365**.
Direct messages and scheduled sequences use Microsoft Graph after connection. Gmail and other
existing SMTP accounts continue to use their saved app passwords.

## One-time administrator setup

1. Create an application in Microsoft Entra **App registrations**. For both work accounts and
   personal Outlook/Hotmail accounts, choose **Accounts in any organizational directory and
   personal Microsoft accounts**. Use `common` for the tenant setting below.
2. Add a **Web** platform redirect URI matching the backend callback exactly, for example
   `http://localhost:5000/api/microsoft-mail/callback`. Substitute your actual backend port.
   Production must use HTTPS. Do not register this as a single-page application redirect.
3. Add delegated Microsoft Graph permissions **User.Read** and **Mail.Send**. The sign-in flow
   also requests **offline_access** so scheduled messages can send without another login.
   Some organizations require an administrator to grant consent.
4. Create a client secret and put its **value**, not its ID, in the backend environment.
5. Generate a separate token encryption key:

   ```sh
   node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"
   ```

6. Configure these environment variables on the backend:

   ```dotenv
   MICROSOFT_CLIENT_ID=<application-client-id>
   MICROSOFT_CLIENT_SECRET=<client-secret-value>
   MICROSOFT_TENANT_ID=common
   MICROSOFT_REDIRECT_URI=https://your-backend.example/api/microsoft-mail/callback
   MICROSOFT_TOKEN_ENCRYPTION_KEY=<32-byte-base64-key>
   FRONTEND_URL=https://your-frontend.example
   ```

   For local development, localhost HTTP URLs are allowed. `FRONTEND_URL` must match the
   frontend's origin exactly, including port. Keep the encryption key stable across deployments
   and identical across workers/servers; changing it requires users to connect again. Never put
   these secrets into frontend `VITE_` variables or commit them to Git.
7. Restart the backend. Sign in to ATS, open Profile or Follow-ups → Emails, click **Connect**,
   and sign in using the Microsoft mailbox matching the ATS user's saved email address.

## Behavior

- A connected Microsoft account uses its own mailbox through Graph, including scheduled emails.
- Microsoft refresh tokens are encrypted in the user record, excluded from normal user queries,
  and never sent to the frontend. Access tokens remain in memory only for the sending request.
- Sign-in uses PKCE and a single-use state that expires after ten minutes.
- Connecting a different mailbox is rejected. An ATS profile email change requires reconnection.
- Disconnecting removes stored Microsoft credentials. Pending sequences need a valid connection
  when their next message sends; the app does not silently use the server's email account.
- A Graph `202 Accepted` response means Microsoft accepted the message, not confirmed delivery.
- This feature does not change the email behavior of invoices or other non-follow-up modules.

## Verification

Run `node --test tests/microsoftMail.test.js` from `Backend`. Tests mock Microsoft and the database;
they do not send live emails. After configuration, connect an account and send one follow-up to
an address you control to check actual delivery and the sender address.

References: [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow),
[Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).
