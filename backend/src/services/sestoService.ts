import axios from 'axios';
import { config } from '../config';

// =============================================================================
// Sesto Robot Navigation Service
// =============================================================================
// The avatar system runs on a Sesto robot. After check-in, the robot can
// escort the guest to their room by navigating to a pre-configured waypoint.
//
// Waypoints are labelled with the room's `room_for_robot` value (e.g. "RM1204")
// and must be configured on the Sesto fleet management side to match.

export interface SestoNavigationResult {
  success: boolean;
  waypointId: string;
  message: string;
  taskId?: string;
}

/**
 * Command the Sesto robot to navigate to a waypoint.
 *
 * TODO: Your friend configuring the Sesto side needs to:
 *   1. Create a waypoint for each room, labelled with the room_for_robot value
 *      (e.g. "RM1204", "RM1508", etc.)
 *   2. Expose the Sesto REST API endpoint and provide the base URL
 *   3. Confirm the exact API path and payload format for navigation commands
 *
 * Once the Sesto API details are known, replace the placeholder URL and payload
 * in the axios.post call below.
 */
export async function navigateToWaypoint(
  waypointId: string
): Promise<SestoNavigationResult> {
  if (!config.sestoApiUrl) {
    console.log(`[Sesto] No SESTO_API_URL configured — mock navigation to waypoint: ${waypointId}`);
    return {
      success: true,
      waypointId,
      message: `Mock navigation started to waypoint ${waypointId}. Set SESTO_API_URL to enable real robot navigation.`,
      taskId: `mock-task-${Date.now()}`,
    };
  }

  try {
    console.log(`[Sesto] Sending navigation command to waypoint: ${waypointId}`);

    // TODO: Adjust endpoint path and payload once Sesto API format is confirmed
    const response = await axios.post(
      `${config.sestoApiUrl}/navigate`,
      { waypoint_id: waypointId },
      { timeout: 10000 }
    );

    const taskId = response.data?.task_id ?? response.data?.id;
    console.log(`[Sesto] Navigation accepted — task: ${taskId}`);

    return {
      success: true,
      waypointId,
      message: `Robot is now heading to waypoint ${waypointId}.`,
      taskId,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Sesto] Navigation failed for waypoint ${waypointId}:`, errMsg);
    return {
      success: false,
      waypointId,
      message: `Failed to start navigation: ${errMsg}`,
    };
  }
}
