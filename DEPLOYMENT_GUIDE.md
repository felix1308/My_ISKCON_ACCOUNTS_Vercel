# MyISKCON Accounts - Deployment Guide

This guide walks you through deploying the Temple Donation Management System to Google Sites with a secure Google Apps Script backend.

---

## Overview

The deployment involves three main components:

1. **Google Sheets** - Database to store all data
2. **Google Apps Script** - Backend server for secure operations
3. **Google Sites** - Frontend hosting

```
┌─────────────────┐     ┌─────────────────────┐     ┌────────────────┐
│  Google Sites   │────▶│  Google Apps Script │────▶│ Google Sheets  │
│  (Frontend)     │     │  (Backend API)      │     │ (Database)     │
└─────────────────┘     └─────────────────────┘     └────────────────┘
```

---

## Step 1: Create Google Sheets Database

### 1.1 Create a New Spreadsheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Click **"+ Blank"** to create a new spreadsheet
3. Rename it to **"MyISKCON Accounts Database"**

### 1.2 Create Required Sheets (Tabs)

Create the following sheets by clicking the **"+"** button at the bottom:

| Sheet Name | Purpose |
|------------|---------|
| Users | Store admin/volunteer accounts |
| Donors | Store donor information |
| Bookings | Store seva bookings |
| Sevas | Store available sevas |
| Centers | Store temple centers |
| Sessions | Store login sessions |
| AuditLog | Store activity logs |

### 1.3 Add Headers to Each Sheet

Copy these headers to the first row of each sheet:

**Users:**
```
id	username	passwordHash	role	centerId	permissions	createdBy	createdAt	updatedAt	isActive
```

**Donors:**
```
id	name	spiritualName	indianPassport	pan	mobile	whatsapp	email	flat	road	po	area	pincode	district	state	country	centerId	createdBy	createdAt	updatedAt
```

**Bookings:**
```
id	donorId	items	totalAmount	paymentStatus	bookingDate	centerId	collectedBy	collectedByCenter	createdAt	updatedAt
```

**Sevas:**
```
id	name	description	amount	isActive	createdAt	updatedAt
```

**Centers:**
```
id	name	city	state	isActive	createdAt	updatedAt
```

**Sessions:**
```
sessionId	userId	username	role	centerId	createdAt	expiresAt	ipAddress	userAgent
```

**AuditLog:**
```
id	timestamp	userId	username	action	resourceType	resourceId	details	ipAddress	success
```

### 1.4 Get the Spreadsheet ID

1. Look at the URL of your spreadsheet:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
   ```
2. Copy the `SPREADSHEET_ID_HERE` part
3. Save it - you'll need it in Step 2

---

## Step 2: Set Up Google Apps Script

### 2.1 Open Apps Script Editor

1. In your Google Sheet, go to **Extensions → Apps Script**
2. This opens the Apps Script editor in a new tab

### 2.2 Add the Backend Code

1. Delete any existing code in `Code.gs`
2. Copy the entire contents of `Code.gs` from this project
3. Paste it into the Apps Script editor

### 2.3 Configure the Spreadsheet ID

Find this line near the top of the code:
```javascript
const SPREADSHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE';
```

Replace `YOUR_GOOGLE_SHEET_ID_HERE` with your actual Spreadsheet ID from Step 1.4.

### 2.4 Change the Password Salt (IMPORTANT!)

Find this line:
```javascript
const PASSWORD_SALT = 'ISKCON_TEMPLE_2024_SECURE_SALT_CHANGE_ME';
```

Replace it with a unique random string. Example:
```javascript
const PASSWORD_SALT = 'MyTemple_XyZ123_UniqueString_2024';
```

**⚠️ WARNING:** Once you set this, DO NOT change it, or all existing passwords will become invalid!

### 2.5 Save the Project

1. Press **Ctrl+S** (or Cmd+S on Mac)
2. Name the project: **"MyISKCON Backend"**

### 2.6 Deploy as Web App

1. Click **Deploy → New deployment**
2. Click the gear icon next to "Select type" → choose **"Web app"**
3. Configure:
   - **Description:** "MyISKCON Backend v1"
   - **Execute as:** "Me (your-email@gmail.com)"
   - **Who has access:** "Anyone"
4. Click **Deploy**
5. Click **Authorize access** → Select your Google account → Allow permissions
6. Copy the **Web App URL** (looks like `https://script.google.com/macros/s/XXXX/exec`)
7. Save this URL - you'll need it in Step 3

### 2.6a Get the Web App URL (BASE URL) / Verify Backend

**To get or confirm your API BASE URL:**

1. In Apps Script: **Deploy → Manage deployments**
2. Under "Web app", click the **pencil (Edit)** icon
3. Copy the **"Web app URL"** — this is your BASE URL (ends with `/exec`)
4. Paste this exact URL into `myiskcon.html` as `APPS_SCRIPT_URL`

**To verify the deployed backend has Razorpay (after you update Code.gs):**

1. After saving and deploying a **new version** (see below), open this URL in your browser (replace with your URL):
   ```
   https://script.google.com/macros/s/YOUR_ID/exec?data=%7B%22action%22%3A%22ping%22%7D
   ```
2. You should see JSON like: `{"isOk":true,"message":"MyISKCON Backend is running","version":"1.1","hasRazorpay":true}`
3. If you see `"hasRazorpay":true`, the correct backend is deployed. If you see `"Unknown action"` when paying, the frontend is still hitting an old deployment — create a **new version** (see below).

**When you update Code.gs you must create a NEW VERSION:**

1. **Deploy → Manage deployments**
2. Click the **pencil (Edit)** next to the Web app
3. Under **Version**, select **"New version"**
4. Click **Deploy** (the Web app URL does not change)

### 2.7 Set Up Automatic Session Cleanup

1. In Apps Script, go to **Triggers** (clock icon on left sidebar)
2. Click **"+ Add Trigger"**
3. Configure:
   - **Function:** cleanupExpiredSessions
   - **Event source:** Time-driven
   - **Type:** Hour timer
   - **Interval:** Every hour
4. Click **Save**

### 2.8 Initialize the Database

1. In Apps Script editor, select `initializeDatabase` function
2. Click **Run**
3. This creates default sevas and centers

---

## Step 3: Configure the Frontend

### 3.1 Update myiskcon.html

Open `myiskcon.html` and find these lines near the top:

```javascript
const PRODUCTION_MODE = false;
const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';
```

Change them to:

```javascript
const PRODUCTION_MODE = true;
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

Replace the URL with your Web App URL from Step 2.6.

### 3.2 Test Locally First (Optional but Recommended)

1. Before uploading to Google Sites, test the file locally
2. Open `myiskcon.html` in a web browser
3. Try logging in with username: `admin`, password: `admin`
4. If it works, proceed to Step 4

---

## Step 4: Deploy to Google Sites

### 4.1 Create a Google Site

1. Go to [Google Sites](https://sites.google.com)
2. Click **"+ Blank"** to create a new site
3. Name it: **"MyISKCON Accounts"**

### 4.2 Add the Application

Since Google Sites doesn't allow direct HTML upload, you have two options:

#### Option A: Embed from Google Drive (Recommended)

1. Upload `myiskcon.html` to Google Drive
2. Right-click → **Get link** → Change to "Anyone with the link"
3. In Google Sites:
   - Click **Insert → Embed**
   - Select "By URL"
   - Enter the Google Drive URL
4. Resize the embed to full page

#### Option B: Host on GitHub Pages (Better Performance)

1. Create a GitHub repository
2. Upload `myiskcon.html` as `index.html`
3. Enable GitHub Pages (Settings → Pages → Source: main branch)
4. Get your GitHub Pages URL: `https://yourusername.github.io/repo-name`
5. In Google Sites:
   - Click **Insert → Embed**
   - Enter the GitHub Pages URL

### 4.3 Configure Site Settings

1. Click the gear icon (Settings)
2. Under "Custom URL", add your domain if available
3. Enable HTTPS (should be automatic)

### 4.4 Publish the Site

1. Click **Publish** (top right)
2. Choose your site URL
3. Click **Publish**

---

## Step 5: First-Time Setup

### 5.1 Change Superadmin Password

1. Visit your deployed site
2. Login with: username: `admin`, password: `admin`
3. You'll be prompted to change the password
4. Set a strong password (minimum 8 characters)

### 5.2 Add Centers

1. Go to **Centers** tab (Superadmin only)
2. Add your temple centers

### 5.3 Add Sevas

1. Go to **Manage Sevas** tab
2. Add or modify available sevas

### 5.4 Create Admin Users

1. Go to **Users** tab
2. Add admin users for each center
3. Assign appropriate permissions

---

## Security Checklist

Before going live, verify:

- [ ] Changed the PASSWORD_SALT in Code.gs
- [ ] Changed the default superadmin password
- [ ] Set PRODUCTION_MODE = true
- [ ] Set correct APPS_SCRIPT_URL
- [ ] Tested all features work correctly
- [ ] Set up automatic session cleanup trigger
- [ ] Verified Google Sheet sharing is restricted (only your account)

---

## Maintenance

### Viewing Audit Logs

1. Open the Google Sheet
2. Go to **AuditLog** tab
3. View all user activities, login attempts, and data changes

### Backing Up Data

1. Periodically download the Google Sheet as Excel/CSV
2. Or use Google Takeout for automatic backups

### Updating the Application

To update the frontend:
1. Modify `myiskcon.html`
2. Re-upload to Google Drive or push to GitHub
3. Clear browser cache and refresh

To update the backend:
1. Modify `Code.gs` in Apps Script
2. Deploy → New deployment (or Manage deployments → Edit)

---

## Troubleshooting

### "Invalid username or password"
- Verify the APPS_SCRIPT_URL is correct
- Check if the Apps Script is deployed
- Check the AuditLog sheet for login attempts

### Data not saving
- Verify the Spreadsheet ID in Code.gs
- Check that you have edit access to the Sheet
- Check the browser console for errors

### CORS errors
- Ensure the Web App is deployed with "Anyone" access
- Try redeploying the Apps Script

### Session expired frequently
- Check the SESSION_TIMEOUT_HOURS setting (default 24)
- Verify the cleanup trigger isn't too aggressive

---

## Support

For issues or questions:
1. Check the AuditLog for error details
2. Review the browser console (F12 → Console)
3. Verify all configuration values are correct

---

## Quick Reference

| Item | Value |
|------|-------|
| Default Superadmin | username: admin, password: admin |
| Session Timeout | 24 hours |
| Password Requirements | Minimum 8 characters |
| Supported Roles | superadmin, admin, volunteer, donor |
