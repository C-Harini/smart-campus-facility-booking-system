export type Role = 'student' | 'admin';

export interface User {
  _id: string;
  name: string;
  email: string;
  role: Role;
  department?: string;
  createdAt?: string;
}

export type FacilityStatus = 'Active' | 'Inactive' | 'Maintenance';

export interface Facility {
  _id: string;
  name: string;
  type: string;
  location: string;
  capacity: number;
  description: string;
  equipment: string[];
  availableDays: string[];
  openingTime: string;
  closingTime: string;
  slotDuration: number;
  minDuration: number;
  maxDuration: number;
  requiresApproval: boolean;
  status: FacilityStatus;
  image: string;
}

export interface Slot {
  startTime: string;
  endTime: string;
  available: boolean;
  reason?: 'booked' | 'past';
}

export interface Range {
  startTime: string;
  endTime: string;
}

export interface Availability {
  facilityId: string;
  facilityName: string;
  date: string;
  open: boolean;
  reason?: string;
  openingTime: string;
  closingTime: string;
  slots: Slot[];
  freeRanges: Range[];
}

export type BookingStatus = 'Pending' | 'Confirmed' | 'Rejected' | 'Cancelled' | 'Completed';

export interface Booking {
  _id: string;
  bookingId: string;
  facility?: { _id: string; name: string; type: string; location: string };
  user?: { _id: string; name: string; email: string; department?: string };
  date: string;
  startTime: string;
  endTime: string;
  purpose: string;
  participants: number;
  status: BookingStatus;
  adminNote?: string;
  createdAt: string;
}

export interface Stats {
  totalFacilities: number;
  activeFacilities: number;
  totalUsers: number;
  totalBookings: number;
  pendingBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  completedBookings: number;
  rejectedBookings: number;
  todayBookings: number;
}

export interface Reports {
  byStatus: Record<string, number>;
  perFacility: { facility: string; type: string; total: number; active: number; cancelled: number; hoursBooked: number }[];
  perDay: { date: string; count: number }[];
}
