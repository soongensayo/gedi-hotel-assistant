import { config } from '../config';

export interface SestoNavigationResult {
  success: boolean;
  message: string;
  waypointId?: string;
}

/**
 * Send a navigation command to the Sesto robot to move to a specific waypoint.
 *
 * The waypoint ID corresponds to the `room_for_robot` column in the rooms table
 * and must match a waypoint label configured on the Sesto robot.
 */
export async function navigateToWaypoint(
  waypointId: string
): Promise<SestoNavigationResult> {
  if (!config.sestoApiUrl) {
    console.warn('[Sesto] SESTO_API_URL not configured — skipping navigation command');
    return {
      success: true,
      message: `Navigation to waypoint ${waypointId} acknowledged (Sesto API not configured — running in mock mode).`,
      waypointId,
    };
  }

  const url = `${config.sestoApiUrl}/navigate`;

  try {
    console.log(`[Sesto] Sending navigation command to waypoint: ${waypointId}`);

    // TODO: Replace with the actual Sesto API request format once confirmed.
    // The expected contract is: POST /navigate with { waypoint_id: string }
    // Your friend configuring Sesto should confirm the exact endpoint and payload.
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypoint_id: waypointId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Sesto] Navigation failed (${response.status}):`, errorText);
      return {
        success: false,
        message: `Robot navigation failed: ${response.statusText}`,
        waypointId,
      };
    }

    const data = await response.json();
    console.log(`[Sesto] Navigation command accepted for waypoint: ${waypointId}`, data);

    return {
      success: true,
      message: `Robot is now heading to waypoint ${waypointId}.`,
      waypointId,
    };
  } catch (err) {
    console.error('[Sesto] Navigation request error:', err);
    return {
      success: false,
      message: `Failed to contact the robot: ${(err as Error).message}`,
      waypointId,
    };
  }
}
