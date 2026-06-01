import { HotelMap } from '../components/HotelMap';

export function PropertyTourScreen() {
  return (
    <div className="flex h-full flex-col justify-center gap-2.5">
      <h3 className="text-center text-lg text-[var(--color-hotel-accent)]">Property tour</h3>
      <HotelMap />
    </div>
  );
}
