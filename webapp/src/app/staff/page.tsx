import type { Metadata } from 'next';
import StaffCallClient from './StaffCallClient';

export const metadata: Metadata = {
  title: 'Staff Portal — The Grand Azure',
  description: 'Hotel front desk video call portal',
};

export default function StaffPage() {
  return <StaffCallClient />;
}
