// src/utils/mailer.js
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

const {
  GMAIL_USER,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  MAIL_FROM,
  NODE_ENV,
} = process.env;

// Redirect usado comúnmente para generar el refresh token con OAuth Playground.
// No afecta el envío desde el servidor.
const REDIRECT_URI = "https://developers.google.com/oauthplayground";

function assertEnv(name, value) {
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
}

// ✅ Reutilizamos el OAuth client (no lo recreamos por cada email)
let oauth2ClientSingleton = null;
function getOAuthClient() {
  if (!oauth2ClientSingleton) {
    assertEnv("GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID);
    assertEnv("GOOGLE_CLIENT_SECRET", GOOGLE_CLIENT_SECRET);

    oauth2ClientSingleton = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      REDIRECT_URI
    );
  }

  // Siempre re-seteamos credenciales por si cambiaste env en runtime
  oauth2ClientSingleton.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2ClientSingleton;
}

async function getAccessToken() {
  assertEnv("GMAIL_USER", GMAIL_USER);
  assertEnv("GOOGLE_REFRESH_TOKEN", GOOGLE_REFRESH_TOKEN);

  const oauth2Client = getOAuthClient();

  const accessTokenResponse = await oauth2Client.getAccessToken();

  const accessToken =
    typeof accessTokenResponse === "string"
      ? accessTokenResponse
      : accessTokenResponse?.token;

  if (!accessToken) {
    throw new Error("No se pudo obtener accessToken de Google OAuth2");
  }

  return accessToken;
}

// ✅ Reutilizamos transporter cuando se pueda (pero regeneramos token cada envío)
let transporterSingleton = null;

async function getTransporter() {
  const accessToken = await getAccessToken();

  // Creamos una sola vez, pero actualizamos accessToken en cada envío
  if (!transporterSingleton) {
    transporterSingleton = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: GMAIL_USER,
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        refreshToken: GOOGLE_REFRESH_TOKEN,
        accessToken, // se reemplazará por email
      },
      // ✅ timeouts sanos (evita que se quede colgado)
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    // ✅ Debug opcional en development
    if (NODE_ENV !== "production") {
      try {
        await transporterSingleton.verify();
        console.log("✅ Mailer OK (Gmail OAuth2 verificado)");
      } catch (e) {
        console.warn("⚠️ Mailer verify falló (puede enviar igual):", e?.message || e);
      }
    }
  }

  return { transporter: transporterSingleton, accessToken };
}

/**
 * sendMail
 * @param {Object} params
 * @param {string} params.to
 * @param {string} params.subject
 * @param {string} [params.html]
 * @param {string} [params.text]
 */
async function sendMail({ to, subject, html, text }) {
  if (!to || !subject) throw new Error("sendMail requiere 'to' y 'subject'");

  const { transporter, accessToken } = await getTransporter();

  // ✅ Actualiza token para este envío sin reconstruir todo
  transporter.options.auth.accessToken = accessToken;

  const from = MAIL_FROM || `Xuping Regina <${GMAIL_USER}>`;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  if (NODE_ENV !== "production") {
    console.log("✉️ Email enviado:", {
      to,
      subject,
      messageId: info?.messageId,
      accepted: info?.accepted,
      rejected: info?.rejected,
    });
  }

  return info;
}

module.exports = { sendMail };
