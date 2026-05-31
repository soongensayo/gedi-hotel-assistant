import { Route, Routes } from 'react-router-dom';
import { AvatarGuestApp } from './avatar/AvatarGuestApp';
import { GuestApp } from './GuestApp';
import { StaffApp } from './staff/StaffApp';

const isAvatarMode =
  import.meta.env.MODE === 'avatar' ||
  import.meta.env.VITE_STANFORD_GUEST_MODE === 'avatar';

export default function App() {
  return (
    <div className="h-full w-full">
      <Routes>
        <Route path="/" element={isAvatarMode ? <AvatarGuestApp /> : <GuestApp />} />
        <Route path="/staff" element={<StaffApp />} />
      </Routes>
    </div>
  );
}
