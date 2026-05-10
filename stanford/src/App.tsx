import { Route, Routes } from 'react-router-dom';
import { GuestApp } from './GuestApp';
import { StaffApp } from './staff/StaffApp';

export default function App() {
  return (
    <div className="h-full w-full">
      <Routes>
        <Route path="/" element={<GuestApp />} />
        <Route path="/staff" element={<StaffApp />} />
      </Routes>
      <footer className="pointer-events-none fixed bottom-1 left-0 right-0 z-50 text-center text-[10px] text-white/25">
        LuxeDrive Stanford showcase · Guest <span className="text-white/40">/</span> Staff{' '}
        <span className="text-white/40">/staff</span>
      </footer>
    </div>
  );
}
