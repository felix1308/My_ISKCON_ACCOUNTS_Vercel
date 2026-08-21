// ============================================================================
// Shared domain types — mirror the legacy Apps Script data model so the
// React frontend and the API layer speak the same shape.
// ============================================================================

export type Role =
  | "superadmin"
  | "admin"
  | "volunteer"
  | "donor"
  | "developer"
  | "dept_staff"
  | "EntryScanner"
  | "SevaScanner"
  | "PrasadamScanner";

export interface Permissions {
  view_dashboard?: boolean;
  booking?: boolean;
  reports?: boolean;
  manage_donors?: boolean;
  manage_sevas?: boolean;
  manage_users?: boolean;
  donor_logins?: boolean;
  receipts?: boolean;
  manage_centers?: boolean;
  manage_temples?: boolean;
  manage_events?: boolean;
  [k: string]: boolean | undefined;
}

/** The caller principal attached to every authenticated request. */
export interface Principal {
  backendId: string;
  type: "user" | "donor_user";
  username: string;
  role: Role;
  centerId: string;
  templeId?: string;
  departmentId?: string;
  donorId?: string;
  permissions: Permissions;
  cashbooks: string[] | "*";
  superadminDetained?: boolean;
  donorData?: Record<string, unknown>;
  expiresAt: string;
}

export interface User {
  id: string;
  username: string;
  role: Role;
  centerId: string | null;
  templeId: string | null;
  departmentId: string | null;
  permissions: Permissions;
  cashbooks: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

/** User row including the password hash — never sent to the client. */
export interface UserWithCredentials extends User {
  passwordHash: string;
  passwordScheme: "bcrypt" | "legacy_sha256";
}

export interface Donor {
  id: string;
  name: string;
  spiritualName: string;
  indianPassport: boolean;
  pan: string; // decrypted plaintext only at the API boundary; ciphertext at rest
  mobile: string;
  whatsapp: string;
  email: string;
  flat: string;
  road: string;
  po: string;
  area: string;
  pincode: string;
  district: string;
  state: string;
  country: string;
  tallyName: string;
  centerId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DonorWithCredentials extends Donor {
  passwordHash: string;
  passwordScheme: "bcrypt" | "legacy_sha256";
}

export interface BookingItem {
  id?: string;
  sevaId?: string;
  name?: string;
  description?: string;
  amount?: number;
  quantity?: number;
  bookingDate?: string;
  [k: string]: unknown;
}

export interface Booking {
  id: string;
  donorId: string;
  items: BookingItem[];
  totalAmount: number;
  paymentStatus: "pending" | "paid";
  paymentMode: string;
  bookingDate: string;
  centerId: string | null;
  collectedBy: string;
  collectedByCenter: string;
  chequeBankAccountId: string;
  festivalQR: boolean;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  paidAt: string;
  remarks: string;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  donorId: string;
  voucherNo: string;
  txnDate: string;
  amount: number;
  transactionDetails: string;
  bank: string;
  transactionType: string;
  tallyLedger: string;
  status80g: string;
  branch: string;
  bookingId: string | null;
  centerId: string | null;
  createdAt: string;
}

export interface Seva {
  id: string;
  name: string;
  description: string;
  amount: number;
  centerId: string | null;
  isActive: boolean;
  darshanQR: string;
  sevaQR: string;
  prasadamQR: string;
  notifyWhatsapp: boolean;
  /** Comma-separated phone numbers that get a WhatsApp reminder on paid bookings. */
  notifyNumbers: string;
  createdAt: string;
  updatedAt: string;
}

export interface Center {
  id: string;
  name: string;
  city: string;
  state: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  templeId: string | null;
}

export interface Temple {
  id: string;
  name: string;
  city: string;
  state: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Department {
  id: string;
  name: string;
  type: string;
  centerId: string | null;
  templeId: string | null;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentHead {
  id: string;
  name: string;
  role: string;
  phone: string;
  templeId: string | null;
  centerId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BankAccount {
  id: string;
  name: string;
  accountNumber: string;
  bankName: string;
  centerId: string | null;
  paymentGatewayId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentGateway {
  id: string;
  name: string;
  razorpayKeyId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  title: string;
  description: string;
  eventDate: string;
  eventTime: string;
  venue: string;
  price: number;
  capacity: number;
  departmentId: string | null;
  centerId: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventBooking {
  id: string;
  eventId: string;
  donorId: string;
  quantity: number;
  totalAmount: number;
  paymentStatus: "pending" | "paid";
  paymentMode: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  paidAt: string;
  remarks: string;
  bookedBy: string;
  centerId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ----------------------- API envelope -----------------------

export interface ApiOk<T = unknown> {
  isOk: boolean;
  data?: T;
  [k: string]: unknown;
}

export interface ApiErr {
  isOk: false;
  error: string;
  [k: string]: unknown;
}

export type ApiResult = ApiOk | ApiErr;

/** The session object the frontend persists in localStorage. */
export interface ClientSession {
  sessionId: string;
  userId: string;
  username: string;
  role: Role;
  centerId: string;
  isDonor: boolean;
  permissions: Permissions;
  expiresAt: string;
}
