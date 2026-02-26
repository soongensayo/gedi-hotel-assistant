interface CheckinEmailData {
  guestName: string;
  roomNumber: string;
  roomType: string;
  floor: number;
  checkInDate: string;
  checkOutDate: string;
  confirmationCode: string;
  hotelName: string;
  keyCardNumber: string;
  hasWalletPass: boolean;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function capitalizeRoom(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function buildCheckinEmailSubject(data: CheckinEmailData): string {
  return `Welcome to ${data.hotelName} — Room ${data.roomNumber}`;
}

export function buildCheckinEmailHtml(data: CheckinEmailData): string {
  const walletSection = data.hasWalletPass
    ? `
        <tr>
          <td style="padding: 24px 32px; text-align: center;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
              <tr>
                <td style="background-color: #0f172a; border-radius: 12px; padding: 20px 28px; text-align: center;">
                  <p style="color: #c4a265; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 6px 0; font-family: Arial, sans-serif;">
                    Digital Room Key
                  </p>
                  <p style="color: #94a3b8; font-size: 14px; margin: 0; font-family: Arial, sans-serif;">
                    Your Apple Wallet pass is attached to this email.<br/>
                    Open it on your iPhone to add it to Wallet.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Check-in Confirmation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f1f5f9;">
    <tr>
      <td style="padding: 40px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="margin: 0 auto; max-width: 560px;">

          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 40px 32px; border-radius: 16px 16px 0 0; text-align: center;">
              <p style="color: #c4a265; font-size: 12px; letter-spacing: 3px; text-transform: uppercase; margin: 0 0 8px 0; font-family: Arial, sans-serif;">
                ${data.hotelName}
              </p>
              <h1 style="color: #ffffff; font-size: 26px; font-weight: 300; margin: 0; font-family: 'Helvetica Neue', Arial, sans-serif;">
                Check-in Confirmed
              </h1>
            </td>
          </tr>

          <!-- Welcome -->
          <tr>
            <td style="background-color: #ffffff; padding: 32px 32px 16px 32px;">
              <p style="color: #334155; font-size: 16px; line-height: 1.6; margin: 0; font-family: Arial, sans-serif;">
                Dear ${data.guestName},
              </p>
              <p style="color: #64748b; font-size: 15px; line-height: 1.6; margin: 12px 0 0 0; font-family: Arial, sans-serif;">
                Welcome! Your check-in is complete and your room is ready.
              </p>
            </td>
          </tr>

          <!-- Room Card -->
          <tr>
            <td style="background-color: #ffffff; padding: 16px 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: linear-gradient(135deg, #0f172a, #1e293b); border-radius: 12px; overflow: hidden;">
                <tr>
                  <td style="padding: 28px 24px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td>
                          <p style="color: #c4a265; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; margin: 0 0 4px 0; font-family: Arial, sans-serif;">
                            Your Room
                          </p>
                          <p style="color: #ffffff; font-size: 36px; font-weight: 300; margin: 0; font-family: 'Helvetica Neue', Arial, sans-serif;">
                            ${data.roomNumber}
                          </p>
                          <p style="color: #94a3b8; font-size: 13px; margin: 4px 0 0 0; font-family: Arial, sans-serif;">
                            ${capitalizeRoom(data.roomType)} &middot; Floor ${data.floor}
                          </p>
                        </td>
                        <td style="text-align: right; vertical-align: top;">
                          <p style="color: #c4a265; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; margin: 0; font-family: Arial, sans-serif;">
                            Confirmation
                          </p>
                          <p style="color: #ffffff; font-size: 14px; font-family: 'Courier New', monospace; margin: 4px 0 0 0;">
                            ${data.confirmationCode}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Stay Details -->
          <tr>
            <td style="background-color: #ffffff; padding: 16px 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="padding: 16px; background-color: #f8fafc; border-radius: 8px; width: 50%;">
                    <p style="color: #94a3b8; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 4px 0; font-family: Arial, sans-serif;">
                      Check-in
                    </p>
                    <p style="color: #334155; font-size: 14px; margin: 0; font-family: Arial, sans-serif;">
                      ${formatDate(data.checkInDate)}
                    </p>
                  </td>
                  <td style="width: 12px;"></td>
                  <td style="padding: 16px; background-color: #f8fafc; border-radius: 8px; width: 50%;">
                    <p style="color: #94a3b8; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 4px 0; font-family: Arial, sans-serif;">
                      Check-out
                    </p>
                    <p style="color: #334155; font-size: 14px; margin: 0; font-family: Arial, sans-serif;">
                      ${formatDate(data.checkOutDate)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${walletSection}

          <!-- Footer -->
          <tr>
            <td style="background-color: #ffffff; padding: 24px 32px 32px 32px; border-radius: 0 0 16px 16px;">
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 0 0 20px 0;" />
              <p style="color: #94a3b8; font-size: 13px; line-height: 1.6; margin: 0; text-align: center; font-family: Arial, sans-serif;">
                If you need anything during your stay, our concierge team is available 24/7.
              </p>
              <p style="color: #c4a265; font-size: 12px; letter-spacing: 1px; text-align: center; margin: 16px 0 0 0; font-family: Arial, sans-serif;">
                ${data.hotelName}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}
