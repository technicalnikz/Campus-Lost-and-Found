# CSPC Lost & Found Management System — Defense & Showcase Guide

**Course:** Application Development (Midterm Project — Round 1)  
**Date:** September 2026

---

## 1. Presentation Script (10-Minute Showcase)

### Opening (1 minute)

> "Good day! We are [Team Name] and we will present the CSPC Lost & Found Management System — a Node.js web application built to digitize the campus lost-and-found process for Camarines Sur Polytechnic Colleges."

**Key talking points:**
- The current problem: physical logbooks, no matching, lost items go unreturned.
- Our solution: a centralized, role-based online platform with smart matching.

---

### System Architecture Overview (2 minutes)

**Demonstrate the technical stack:**
- **Backend:** Node.js + Express 4.x with modular route structure
- **Authentication:** `express-session` for sessions, `bcryptjs` for password hashing
- **Data:** JSON file persistence (no database installation needed)
- **Frontend:** Vanilla HTML/CSS/JS consuming RESTful API endpoints

**Show the project directory structure:**
```
lostfound/
├── server.js          → Express entry point
├── middleware/         → auth.js (RBAC), validate.js (sanitization)
├── routes/            → authRoutes.js, itemRoutes.js
├── data/              → users.json, items.json
└── public/            → index.html, login.html, style.css
```

---

### Live Demo (5 minutes)

#### Demo Step 1: Authentication Flow
1. Open `http://localhost:3000` — show the public landing page.
2. Click "Login" — demonstrate the login page.
3. Log in as a **student** (`student@cspc.edu.ph` / `StudentPassword123!`).
4. Show the dashboard: stats cards, user greeting, role indicator.

#### Demo Step 2: Report a Lost Item
1. Click "Report Lost/Found".
2. Fill in: "Black Umbrella", Category = "Others", Type = "Lost", Location = "College of Computer Studies (CCS)".
3. Submit — show the generated reference code (`CSPC-LF-2026-XXX`).
4. Show server-side validation by submitting an empty form.

#### Demo Step 3: Smart Match Detection
1. Log out the student. Log in as **admin** (`admin@cspc.edu.ph` / `AdminPassword123!`).
2. Report a found item: "Casio Scientific Calculator FX-991ES" at CEA.
3. Show the automatic match notification linking it to the existing lost calculator report.

#### Demo Step 4: Admin Claim Management
1. As admin, click "Mark Claimed" on a matched item.
2. Show the status change to "Claimed" with timestamp.
3. Demonstrate "Restore" to return it to active status.

#### Demo Step 5: Digital "Found" QR Code Stickers (Preventive Feature)
1. Click "🏷️ QR Sticker" on any item or registered personal belonging.
2. Show the generated unique, anonymous QR code sticker (CSPC-branded, formatted for pasting onto laptops, tumblers, or binders).
3. Demonstrate the anonymous messaging screen: Finder scans QR to notify the owner directly without revealing phone numbers or social media.

#### Demo Step 6: Security Demonstration
1. Show that student accounts cannot access admin actions (Mark Claimed, Delete).
2. Open browser DevTools Network tab — show `httpOnly` session cookie.
3. Attempt to submit `<script>alert('XSS')</script>` in a form field — show it being sanitized.

---

### Closing (2 minutes)

**Summarize unique features:**
1. **Smart Match Algorithm** — Automatic keyword + location + category matching between lost and found items.
2. **CSPC Campus Integration** — Location dropdown uses official CSPC offices from [cspc.edu.ph/offices/](https://cspc.edu.ph/offices/).
3. **Digital "Found" QR Code Stickers** — Preventive feature allowing students to register belongings before getting lost, generating anonymous QR stickers with privacy-protected messaging.
4. **Ownership Verification Hints** — Reporters can add private hints for proving ownership.
5. **Campus Hotspot Statistics** — Dashboard shows which campus locations have the most activity.

> "Thank you for your time. We are now open for questions."

---

## 2. Team Role Division (3-Person Team)

| Team Member | Role | Responsibilities |
| :--- | :--- | :--- |
| **Member 1** (Lead Developer) | Backend & Architecture | `server.js`, `routes/authRoutes.js`, `routes/itemRoutes.js`, session/auth flow, data persistence, API design |
| **Member 2** (Frontend & UX) | UI Implementation | `public/index.html`, `public/login.html`, `public/style.css`, digital QR sticker modal & print layout, responsive design, CSPC branding |
| **Member 3** (QA & Documentation) | Testing & Compliance | `REQUIREMENTS.md`, `AI_DISCLOSURE.md`, `DEFENSE_GUIDE.md`, input validation middleware, end-to-end testing, bug reporting |

### Suggested Git Commit Breakdown per Member

| Member | Example Commits |
| :--- | :--- |
| Member 1 | `feat: add Express server with session middleware`, `feat: implement auth routes with bcrypt`, `feat: add item CRUD and smart match API` |
| Member 2 | `feat: create login page with CSPC branding`, `feat: build dashboard with API integration`, `style: add dark/yellow color scheme and responsive layout` |
| Member 3 | `docs: add REQUIREMENTS.md with stakeholders and use cases`, `docs: add AI_DISCLOSURE.md`, `feat: add server-side input validation middleware`, `test: verify auth flow and role restrictions` |

---

## 3. Counterpart Critique Matrix

Use this rubric when evaluating the opposing team's project during the defense:

| Criterion | Weight | Exemplary (5) | Proficient (4) | Developing (3) | Beginning (1-2) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Application Implementation** | 25% | Node.js/Express with modular routes, clean structure, and seamless task completion | Working Express app with minor structural issues | Partially working; key routes missing or broken | Static files only; no server-side logic |
| **Access Control & Data Handling** | 15% | Hashed passwords, session auth, role middleware, server-side validation | Auth works but validation is basic or client-side only | Login exists but no role separation or hashing | No authentication or plain-text passwords |
| **Requirements & Campus Fitness** | 20% | Comprehensive SRS with real stakeholders, FRs, NFRs, and detailed use cases | Requirements exist but lack specificity or campus context | Generic requirements not tailored to campus use | Missing or trivially short requirements document |
| **GitHub & Compliance** | 25% | MIT License, AI Disclosure, commit history, collaborative workflow | License and disclosure present but shallow | Partial compliance — missing license or disclosure | No repository or documentation |
| **Showcase & Defense** | 15% | Structured demo, all members speak, can explain all components | Good demo but one member dominates or struggles with questions | Disorganized demo, limited technical explanation | No live demo or cannot run the application |

### Sample Critique Questions to Ask the Opposing Team

1. "How are passwords stored in your system? Can you show the hashing implementation?"
2. "What happens if a user submits an empty form or injects HTML into an input field?"
3. "How does your system differentiate between student and admin actions?"
4. "Can you explain your route structure and why you organized it that way?"
5. "Does your system persist data between server restarts? How?"
6. "What is your AI Disclosure? Can you explain the code that was AI-assisted and how you modified it?"
7. "If two users report similar items, does your system detect the match? How?"

---

## 4. Quick Reference — Test Accounts

| Role | Email | Password |
| :--- | :--- | :--- |
| Admin (SAO Officer) | `admin@cspc.edu.ph` | `AdminPassword123!` |
| Student | `student@cspc.edu.ph` | `StudentPassword123!` |

**Server Start Command:**
```bash
npm install
npm start
# → http://localhost:3000
```

