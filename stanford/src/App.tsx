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
    </div>
  );
}
