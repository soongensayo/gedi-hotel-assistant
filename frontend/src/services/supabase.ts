import { createClient } from '@supabase/supabase-js';

// These are public anon keys - safe for frontend
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Direct Supabase queries (optional - backend proxies most things)
// These are useful for real-time subscriptions or direct reads

export async function fetchRoomsDirectly() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('is_available', true)
    .order('price_per_night', { ascending: true });
  if (error) {
    console.error('Error fetching rooms:', error);
    return [];
  }
  return data;
}

export async function fetchHotelInfoDirectly() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('hotel_info')
    .select('*')
    .single();
  if (error) {
    console.error('Error fetching hotel info:', error);
    return null;
  }
  return data;
}
