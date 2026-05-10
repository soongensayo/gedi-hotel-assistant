import { HotelMap } from '../components/HotelMap';

export function PropertyTourScreen() {
  return (
    <div className="space-y-2">
      <h3 className="text-center text-xl text-[var(--color-hotel-accent)]">Property tour</h3>
      <HotelMap />
    </div>
  );
}
