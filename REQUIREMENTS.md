# CSPC Lost & Found Management System — Software Requirements Specification

**Version:** 1.0  
**Date:** September 2026  
**Prepared for:** CSPC Midterm Project — Round 1

---

## 1. Project Overview

The CSPC Lost & Found Management System is a web application designed for Camarines Sur Polytechnic Colleges (CSPC) to digitize and streamline the campus lost-and-found process. It replaces the traditional logbook approach used by the Student Affairs and Services Office (SASO) with a centralized, accessible, and role-based online platform.

### 1.1 Problem Statement

CSPC students and staff currently rely on physical logbooks and bulletin board postings to report or search for lost and found items. This method is slow, fragile, and lacks any automated matching or tracking. There is no mechanism for verifying ownership claims, and lost items frequently go unreturned because reporters and finders never connect.

### 1.2 Proposed Solution

A Node.js + Express web application that enables students and SASO officers to report, browse, match, and claim lost and found items through a centralized digital system — scoped to official CSPC campus locations.

---

## 2. Stakeholders

| Stakeholder | Role | System Interaction |
| :--- | :--- | :--- |
| **CSPC Students** | Primary end users who lose or find items | Register accounts, report lost/found items, browse listings, print claim slips, verify ownership |
| **Student Affairs & Services Office (SASO)** | Administrative oversight of lost-and-found operations | Manage all item records, approve/deny claims, mark items as returned, delete invalid reports |
| **Campus Security Office** | Physical custodians of found items in some locations | Report found items, assist students with verification at guard posts |
| **College Deans / Department Heads** | Supervise lost-and-found within their college buildings | Awareness of department-specific loss patterns (via campus hotspot statistics) |
| **CSPC Administration (Office of the President)** | Strategic oversight | Policy compliance, approval of digital processes for student services |
| **MIS / ICT Office** | Technical infrastructure support | Server hosting, network configuration, technical maintenance |

---

## 3. Functional Requirements

### FR-01: User Registration and Authentication

- **Description:** The system shall allow students and staff to create accounts and authenticate using an email/password combination.
- **Acceptance Criteria:**
  - Users register with CSPC email, full name, student ID, and department.
  - Passwords are hashed server-side using bcrypt before storage.
  - On successful login, a session is established and persisted for 24 hours.
  - Invalid credentials return appropriate error messages without revealing which field is incorrect.

### FR-02: Role-Based Access Control (RBAC)

- **Description:** The system shall enforce two user roles: `student` and `admin` (SASO Officer).
- **Acceptance Criteria:**
  - Students can report, browse, and print — but cannot delete other users' reports or mark items as claimed/restored.
  - Admins can perform all student actions plus: mark items claimed, restore claimed items, and delete any report.
  - All protected API endpoints verify session authentication and role permissions via middleware.

### FR-03: Report Lost Item

- **Description:** Authenticated users shall be able to submit a lost item report.
- **Acceptance Criteria:**
  - Report form requires: item name, category, report type (lost), campus location, contact information, and description.
  - Optional fields: location detail (e.g., room number), ownership verification hint.
  - A unique reference code (format: `CSPC-LF-2026-XXX`) is auto-generated.
  - All inputs are validated server-side (length, type, allowed values) and sanitized before persistence.

### FR-04: Report Found Item

- **Description:** Authenticated users shall be able to submit a found item report.
- **Acceptance Criteria:**
  - Identical form structure and validation as FR-03 but with report type set to `found`.
  - The system immediately runs the Smart Match algorithm on submission.

### FR-05: Browse, Search, and Filter Items

- **Description:** All users (including unauthenticated visitors) shall be able to browse and search the item registry.
- **Acceptance Criteria:**
  - Filterable by: type (lost/found), category, campus location, status (active/claimed), and free-text keyword search.
  - Search covers item title, description, location, category, and reference code.
  - Results display item details, reference code, date reported, and status.

### FR-06: Smart Match Detection

- **Description:** The system shall automatically detect potential matches between lost and found items.
- **Acceptance Criteria:**
  - Matching is based on keyword overlap in item titles, matching categories, and overlapping campus locations.
  - Common stop words are excluded from keyword analysis.
  - Potential matches are displayed alongside each item listing.

### FR-07: Claim Management

- **Description:** Admin users shall be able to mark items as claimed and restore claimed items back to active status.
- **Acceptance Criteria:**
  - Claiming an item records the timestamp and optional claimant proof text.
  - Restoring a claimed item clears claim metadata and sets status back to `active`.
  - Both actions persist immediately to the data store.

### FR-08: Print Claim Notice Slip

- **Description:** Users shall be able to generate and print a formal CSPC Lost/Found Claim Notice Slip.
- **Acceptance Criteria:**
  - Slip includes CSPC header, reference code, item details, reporter contact, date, and signature blocks.
  - Formatted for standard letter paper (A4/US Letter) via the browser's native print dialog.
  - Slip is branded with official CSPC styling.

---

## 4. Non-Functional Requirements

### NFR-01: Usability

- The interface shall be responsive and functional on both desktop and mobile browsers.
- All forms shall provide clear inline validation feedback.
- Dark/yellow color scheme provides high contrast and readability.

### NFR-02: Security

- All passwords stored as bcrypt hashes (10 salt rounds).
- Session cookies marked `httpOnly` to prevent client-side script access.
- All user inputs sanitized server-side to strip HTML/script injection characters.
- API routes protected by authentication and role middleware.

### NFR-03: Performance

- Page load time shall be under 2 seconds on a local network.
- JSON file I/O operations are synchronous and atomic for data consistency.
- The application shall handle up to 50 concurrent users on a single-server deployment.

### NFR-04: Portability & Ease of Setup

- The system shall run on any machine with Node.js 18+ installed.
- No external database server required — all data persists in flat JSON files.
- Full setup requires only: `npm install` followed by `npm start`.

### NFR-05: Maintainability

- Modular Express architecture: routes, middleware, and data layers are separated.
- Code is commented and organized by concern (authentication, validation, item management).
- File-based data storage allows easy backup and inspection.

---

## 5. Use Cases

### UC-01: Student Reports a Lost Calculator

**Actor:** CSPC Student  
**Precondition:** Student is registered and logged in.  
**Flow:**
1. Student clicks "Report Lost/Found" on the dashboard.
2. Student fills in: Item Name = "Casio FX-991ES Calculator", Category = "Electronics", Type = "Lost", Location = "College of Engineering and Architecture (CEA)", Contact = phone number, Description, and Verification Hint = "Student ID etched inside battery lid".
3. Student submits the form.
4. System validates all fields, generates reference code `CSPC-LF-2026-006`, and saves the report.
5. System runs Smart Match and detects a matching found calculator (CSPC-LF-2026-005) at the same location.
6. Student is notified of the potential match and can coordinate retrieval.

**Postcondition:** Item is saved to the database with a unique reference code. A potential match notification is displayed.

---

### UC-02: Security Guard Reports a Found Backpack

**Actor:** Campus Security (using SASO admin account)  
**Precondition:** Admin account is logged in.  
**Flow:**
1. Security guard logs in using the SASO admin credentials.
2. Fills in the found item report: "Blue Jansport Backpack", Category = "Bags & Wallets", Location = "Learning Resources and Development (Library)".
3. Submits the report.
4. System validates, assigns reference code, and checks for matching lost-item reports.

**Postcondition:** Found item report is publicly visible and searchable.

---

### UC-03: SASO Officer Marks Item as Claimed

**Actor:** SASO Admin  
**Precondition:** Admin is logged in; item exists in active status.  
**Flow:**
1. Admin browses items and locates the target item.
2. Admin clicks "Mark Claimed" and optionally enters claimant proof (e.g., "Verified by student ID").
3. System updates the item status to `claimed`, records the timestamp.
4. Item moves to the claimed section and is no longer shown in active filters.

**Postcondition:** Item status is persisted as `claimed` with audit metadata.

---

### UC-04: Student Prints a Claim Slip

**Actor:** CSPC Student  
**Precondition:** Student has found their item in the system.  
**Flow:**
1. Student locates their item in the listings.
2. Student clicks "Print Claim Slip".
3. System generates a formatted CSPC Claim Notice with reference code, item details, and signature blocks.
4. Browser print dialog opens for physical printing.

**Postcondition:** Student presents the printed claim slip to the SASO office for physical item retrieval.

---

### UC-05: Visitor Browses Lost Items Without an Account

**Actor:** Unauthenticated visitor  
**Precondition:** None.  
**Flow:**
1. Visitor accesses the system URL.
2. Visitor browses the item registry, applies filters, and searches by keyword.
3. Visitor sees item details and reference codes but cannot report items or perform admin actions.

**Postcondition:** Visitor decides to register an account to report a lost item.

---

## 6. Data Dictionary

| Entity | Field | Type | Description |
| :--- | :--- | :--- | :--- |
| **User** | `id` | String | Unique user identifier (e.g., `usr-admin-01`) |
| | `email` | String | CSPC email address |
| | `passwordHash` | String | bcrypt-hashed password |
| | `fullName` | String | Display name |
| | `studentId` | String | CSPC student/staff ID |
| | `role` | Enum | `student` or `admin` |
| | `department` | String | College or office affiliation |
| | `createdAt` | ISO 8601 | Account creation timestamp |
| **Item** | `id` | Number | Unique item identifier |
| | `refCode` | String | Tracking code (e.g., `CSPC-LF-2026-001`) |
| | `title` | String | Item name/description |
| | `category` | Enum | One of 7 predefined categories |
| | `type` | Enum | `lost` or `found` |
| | `location` | String | Official CSPC campus location |
| | `locationDetails` | String | Specific room or area detail |
| | `contact` | String | Reporter contact information |
| | `desc` | String | Detailed item description |
| | `verification` | String | Ownership proof hint |
| | `date` | String | Human-readable report date |
| | `status` | Enum | `active` or `claimed` |
| | `claimed` | Boolean | Whether item has been claimed |
| | `reportedBy` | String | User ID of the reporter |
| | `createdAt` | ISO 8601 | Report creation timestamp |

