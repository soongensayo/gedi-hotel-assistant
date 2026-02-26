import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../config';
import { buildCheckinEmailSubject, buildCheckinEmailHtml } from './templates/checkinEmail';
import type { GeneratedPass } from './wallet/types';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
    throw new Error('SMTP not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env');
  }

  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  return transporter;
}

export interface CheckinEmailPayload {
  to: string;
  guestName: string;
  roomNumber: string;
  roomType: string;
  floor: number;
  checkInDate: string;
  checkOutDate: string;
  confirmationCode: string;
  hotelName: string;
  keyCardNumber: string;
  walletPass?: GeneratedPass;
}

export async function sendCheckinEmail(payload: CheckinEmailPayload): Promise<void> {
  const mailer = getTransporter();

  const hasWalletPass = !!payload.walletPass;

  const subject = buildCheckinEmailSubject({
    ...payload,
    hasWalletPass,
  });

  const html = buildCheckinEmailHtml({
    ...payload,
    hasWalletPass,
  });

  const attachments = payload.walletPass
    ? [
        {
          filename: payload.walletPass.filename,
          content: payload.walletPass.buffer,
          contentType: payload.walletPass.mimeType,
        },
      ]
    : [];

  await mailer.sendMail({
    from: config.smtpFrom,
    to: payload.to,
    subject,
    html,
    attachments,
  });

  console.log(`[Email] Check-in confirmation sent to ${payload.to}`);
}

export function isEmailConfigured(): boolean {
  return !!(config.smtpHost && config.smtpUser && config.smtpPass);
}
