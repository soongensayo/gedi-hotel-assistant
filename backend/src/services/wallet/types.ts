export interface PassData {
  guestName: string;
  guestEmail: string;
  roomNumber: string;
  roomType: string;
  floor: number;
  checkInDate: string;
  checkOutDate: string;
  confirmationCode: string;
  hotelName: string;
  keyCardNumber: string;
}

export interface GeneratedPass {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface WalletProvider {
  generatePass(data: PassData): Promise<GeneratedPass>;
}
