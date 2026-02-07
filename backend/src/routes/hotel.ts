import { Router, Request, Response } from 'express';
import { getHotelInfo, getAvailableRooms, getRoomUpgrades } from '../services/hotelService';

const router = Router();

/**
 * GET /api/hotel/info
 * Get hotel information.
 */
router.get('/info', async (_req: Request, res: Response) => {
  try {
    const info = await getHotelInfo();
    res.json(info);
  } catch (error) {
    console.error('[Hotel Route] Info error:', error);
    res.status(500).json({ error: 'Failed to get hotel info' });
  }
});

/**
 * GET /api/hotel/rooms
 * Get available rooms, optionally filtered by date.
 */
router.get('/rooms', async (req: Request, res: Response) => {
  try {
    const { checkIn, checkOut } = req.query;
    const rooms = await getAvailableRooms(
      checkIn as string | undefined,
      checkOut as string | undefined
    );
    res.json(rooms);
  } catch (error) {
    console.error('[Hotel Route] Rooms error:', error);
    res.status(500).json({ error: 'Failed to get rooms' });
  }
});

/**
 * GET /api/hotel/upgrades
 * Get available room upgrades for a given room type.
 */
router.get('/upgrades', async (req: Request, res: Response) => {
  try {
    const { roomType } = req.query;
    if (!roomType || typeof roomType !== 'string') {
      res.status(400).json({ error: 'roomType query parameter is required' });
      return;
    }
    const upgrades = await getRoomUpgrades(roomType);
    res.json(upgrades);
  } catch (error) {
    console.error('[Hotel Route] Upgrades error:', error);
    res.status(500).json({ error: 'Failed to get upgrades' });
  }
});

export default router;
