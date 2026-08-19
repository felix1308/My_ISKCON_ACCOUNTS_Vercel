# MyISKCON Accounts - Database Schema

This document describes the Google Sheets database structure used by the application.

## Setup Instructions

1. Create a new Google Sheet
2. Create the following sheets (tabs) with exact names:
   - `Users`
   - `Donors`
   - `Bookings`
   - `Sevas`
   - `Centers`
   - `Sessions`
   - `AuditLog`

3. Add the headers (first row) for each sheet as described below

---

## Sheet: Users

Stores all admin, volunteer user accounts (NOT donors).

| Column | Type | Description |
|--------|------|-------------|
| id | String | Unique identifier (e.g., `id_1706123456789_abc123`) |
| username | String | Login username |
| passwordHash | String | SHA-256 hashed password (NEVER plain text) |
| role | String | `admin` or `volunteer` |
| centerId | String | Reference to Centers.id (e.g., `center_bangalore`) |
| permissions | JSON String | Permissions object (e.g., `{"booking":true,"reports":true}`) |
| createdBy | String | Username who created this user |
| createdAt | ISO DateTime | Creation timestamp |
| updatedAt | ISO DateTime | Last update timestamp |
| isActive | Boolean String | `true` or `false` |

**Headers Row:**
```
id | username | passwordHash | role | centerId | permissions | createdBy | createdAt | updatedAt | isActive
```

---

## Sheet: Donors

Stores donor/devotee information.

| Column | Type | Description |
|--------|------|-------------|
| id | String | Unique identifier |
| name | String | Legal full name (required) |
| spiritualName | String | Initiated/spiritual name (optional) |
| indianPassport | Boolean String | `true` or `false` |
| pan | String | PAN number (sensitive - stored encrypted ideally) |
| mobile | String | Mobile number (required) |
| whatsapp | String | WhatsApp number |
| email | String | Email address |
| flat | String | Flat/House number |
| road | String | Street/Road name |
| po | String | Post Office |
| area | String | Area/Locality |
| pincode | String | PIN/ZIP code |
| district | String | District |
| state | String | State |
| country | String | Country |
| centerId | String | Reference to Centers.id |
| createdBy | String | Username who created this donor |
| createdAt | ISO DateTime | Creation timestamp |
| updatedAt | ISO DateTime | Last update timestamp |

**Headers Row:**
```
id | name | spiritualName | indianPassport | pan | mobile | whatsapp | email | flat | road | po | area | pincode | district | state | country | centerId | createdBy | createdAt | updatedAt
```

---

## Sheet: Bookings

Stores all seva/donation bookings.

| Column | Type | Description |
|--------|------|-------------|
| id | String | Unique identifier |
| donorId | String | Reference to Donors.id |
| items | JSON String | Array of seva items (see below) |
| totalAmount | Number | Total booking amount in INR |
| paymentStatus | String | `pending` or `paid` |
| bookingDate | ISO DateTime | Date of booking |
| centerId | String | Reference to Centers.id |
| collectedBy | String | Username who collected the donation |
| collectedByCenter | String | Center of the collector |
| festivalQR | Boolean String | `true` = receipt shows Darshan & Prasadam QR codes for festival validation |
| createdAt | ISO DateTime | Creation timestamp |
| updatedAt | ISO DateTime | Last update timestamp |

**Items JSON Format:**
```json
[
  {
    "id": "seva1",
    "sevaId": "seva1",
    "name": "Abhishekam",
    "description": "Sacred bathing ritual",
    "amount": 501,
    "quantity": 2,
    "bookingDate": "2024-01-15"
  }
]
```

**Headers Row:**
```
id | donorId | items | totalAmount | paymentStatus | bookingDate | centerId | collectedBy | collectedByCenter | festivalQR | createdAt | updatedAt
```

**Note:** If your Bookings sheet already exists with 11 columns, add a new column **festivalQR** (e.g. after `collectedByCenter`) and set header in row 1. New deployments get this column automatically.

---

## Sheet: Sevas

Stores available seva/service types.

| Column | Type | Description |
|--------|------|-------------|
| id | String | Unique identifier (e.g., `seva1`, `seva_custom_123`) |
| name | String | Seva name |
| description | String | Seva description |
| amount | Number | Default amount in INR |
| isActive | Boolean String | `true` or `false` |
| createdAt | ISO DateTime | Creation timestamp |
| updatedAt | ISO DateTime | Last update timestamp |

**Headers Row:**
```
id | name | description | amount | isActive | createdAt | updatedAt
```

---

## Sheet: Centers

Stores temple center/branch information.

| Column | Type | Description |
|--------|------|-------------|
| id | String | Unique identifier (e.g., `center_bangalore`) |
| name | String | Center display name |
| city | String | City name |
| state | String | State name |
| isActive | Boolean String | `true` or `false` |
| createdAt | ISO DateTime | Creation timestamp |
| updatedAt | ISO DateTime | Last update timestamp |

**Headers Row:**
```
id | name | city | state | isActive | createdAt | updatedAt
```

---

## Sheet: Sessions

Stores active user sessions for authentication.

| Column | Type | Description |
|--------|------|-------------|
| sessionId | String | Unique session token |
| userId | String | Reference to Users.id or Donors.id |
| username | String | Username for quick lookup |
| role | String | User role |
| centerId | String | User's center |
| createdAt | ISO DateTime | Session creation time |
| expiresAt | ISO DateTime | Session expiration time |
| ipAddress | String | Client IP address |
| userAgent | String | Browser user agent |

**Headers Row:**
```
sessionId | userId | username | role | centerId | createdAt | expiresAt | ipAddress | userAgent
```

---

## Sheet: AuditLog

Stores all security and data access events.

| Column | Type | Description |
|--------|------|-------------|
| id | String | Unique identifier |
| timestamp | ISO DateTime | Event timestamp |
| userId | String | User who performed action |
| username | String | Username for readability |
| action | String | Action type (see below) |
| resourceType | String | `user`, `donor`, `booking`, `seva`, `center` |
| resourceId | String | ID of affected resource |
| details | JSON String | Additional details |
| ipAddress | String | Client IP address |
| success | Boolean String | `true` or `false` |

**Action Types:**
- `LOGIN` - Successful login
- `LOGIN_FAILED` - Failed login attempt
- `LOGOUT` - User logout
- `PASSWORD_CHANGE` - Password changed
- `CREATE` - Record created
- `UPDATE` - Record updated
- `DELETE` - Record deleted
- `GET_ALL_DATA` - Data retrieval
- `CREATE_DENIED` - Permission denied for create
- `UPDATE_DENIED` - Permission denied for update
- `DELETE_DENIED` - Permission denied for delete

**Headers Row:**
```
id | timestamp | userId | username | action | resourceType | resourceId | details | ipAddress | success
```

---

## Permissions Object

The `permissions` field in Users is a JSON string with the following structure:

```json
{
  "view_dashboard": true,
  "booking": true,
  "reports": true,
  "manage_donors": false,
  "manage_sevas": false,
  "manage_users": false,
  "donor_logins": false,
  "receipts": true
}
```

| Permission | Description |
|------------|-------------|
| view_dashboard | Can view the dashboard |
| booking | Can create/manage bookings |
| reports | Can view reports |
| manage_donors | Can add/edit/delete donors |
| manage_sevas | Can add/edit/delete sevas |
| manage_users | Can add/edit/delete users |
| donor_logins | Can view donor login credentials |
| receipts | Can download receipts |

---

## Role Hierarchy

| Role | Description | Access |
|------|-------------|--------|
| superadmin | Temple administrator | All centers, all features |
| admin | Center administrator | Own center, most features |
| volunteer | Center volunteer | Own center, limited features |
| donor | Registered donor | Own data only |

---

## Quick Setup SQL-like Reference

While Google Sheets doesn't use SQL, here's how to think about the relationships:

```
Centers (1) ──── (N) Users
Centers (1) ──── (N) Donors
Donors  (1) ──── (N) Bookings
Sevas   (N) ──── (N) Bookings (via items JSON)
```

---

## Security Notes

1. **Passwords** are hashed using SHA-256 with a salt - NEVER store plain text
2. **PAN numbers** should ideally be encrypted at rest (not implemented in basic version)
3. **Sessions** expire after 24 hours and are cleaned up automatically
4. **Audit logs** should be retained for compliance (7+ years for financial data)
5. **Access control** is enforced at the API level, not just the UI
