import { Router, Request, Response } from 'express';
import {
  lookupReservation,
  lookupReservationByPassport,
  getGuestByPassport,
} from '../services/hotelService';

const router = Router();

/**
 * GET /api/checkin/lookup
 * Look up a reservation by confirmation code or guest name.
 */
router.get('/lookup', async (req: Request, res: Response) => {
  try {
    const { query } = req.query;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Query parameter is required' });
      return;
    }
    const reservation = await lookupReservation(query);
    res.json(reservation);
  } catch (error) {
    console.error('[Checkin Route] Lookup error:', error);
    res.status(500).json({ error: 'Failed to lookup reservation' });
  }
});

/**
 * GET /api/checkin/lookup-passport
 * Look up a reservation by passport number.
 */
router.get('/lookup-passport', async (req: Request, res: Response) => {
  try {
    const { passportNumber } = req.query;
    if (!passportNumber || typeof passportNumber !== 'string') {
      res.status(400).json({ error: 'passportNumber query parameter is required' });
      return;
    }
    const reservation = await lookupReservationByPassport(passportNumber);
    res.json(reservation);
  } catch (error) {
    console.error('[Checkin Route] Passport lookup error:', error);
    res.status(500).json({ error: 'Failed to lookup by passport' });
  }
});

/**
 * POST /api/checkin/scan-passport
 * Simulate passport scanning (mock mode).
 * Returns mock passport data for the selected test guest.
 */
router.post('/scan-passport', async (_req: Request, res: Response) => {
  try {
    // In mock mode, simulate a scan with a random delay
    await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 1000));

    // Return the first mock guest as the scanned passport
    const guest = await getGuestByPassport('E1234567A');
    if (guest) {
      res.json({
        success: true,
        data: {
          firstName: guest.firstName,
          lastName: guest.lastName,
          nationality: guest.nationality,
          passportNumber: guest.passportNumber,
          dateOfBirth: guest.dateOfBirth,
          expiryDate: '2028-03-14',
          gender: 'M',
        },
      });
    } else {
      res.json({
        success: true,
        data: {
          firstName: 'James',
          lastName: 'Chen',
          nationality: 'Singapore',
          passportNumber: 'E1234567A',
          dateOfBirth: '1985-03-15',
          expiryDate: '2028-03-14',
          gender: 'M',
        },
      });
    }
  } catch (error) {
    console.error('[Checkin Route] Scan error:', error);
    res.json({ success: false, error: 'Scanner error' });
  }
});

/**
 * POST /api/checkin/process-payment
 * Simulate payment processing (mock mode).
 */
router.post('/process-payment', async (req: Request, res: Response) => {
  try {
    const { reservationId, amount, currency } = req.body;

    // Simulate payment processing delay
    await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 1000));

    // Always succeed in mock mode
    res.json({
      success: true,
      transactionId: `TXN-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      amount,
      currency,
      last4: '4242',
      reservationId,
    });
  } catch (error) {
    console.error('[Checkin Route] Payment error:', error);
    res.json({ success: false, error: 'Payment processing failed' });
  }
});

/**
 * POST /api/checkin/complete
 * Complete the check-in process and issue a key card.
 */
router.post('/complete', async (req: Request, res: Response) => {
  try {
    const { reservationId, roomId } = req.body;

    // Simulate key card encoding delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Generate mock key card number
    const keyCardNumber = `KC-${Date.now().toString(36).toUpperCase()}`;

    // Find the room number from mock data
    const roomNumber = roomId === 'room-1' ? '1204'
      : roomId === 'room-2' ? '1508'
      : roomId === 'room-3' ? '2001'
      : roomId === 'room-4' ? '2501'
      : '1204';

    res.json({
      success: true,
      keyCardNumber,
      roomNumber,
      reservationId,
      checkedInAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Checkin Route] Complete error:', error);
    res.status(500).json({ error: 'Failed to complete check-in' });
  }
});

export default router;
