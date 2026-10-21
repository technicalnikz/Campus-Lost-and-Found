# Back2You — CSPC Lost and Found Management System

Back2You is a web-based lost and found system for Camarines Sur Polytechnic Colleges (CSPC). Students can report lost or found items, search campus reports, request claims, register personal belongings for QR-based recovery, and receive notifications. Administrators can manage accounts, reports, claims, announcements, and handover records.

## Features

### Students

- Register with a CSPC student email ending in `@my.cspc.edu.ph`.
- Sign in and maintain a session without signing in again while using the dashboard.
- Report a lost item or an item that was found.
- Add an item name, category, campus location, description, contact information, optional ownership detail, and an optional photo.
- Browse, search, and filter active, lost, found, claimed, and personal registered items.
- Request a claim for an eligible found item when the student has reported the matching lost item.
- Register personal belongings and generate QR recovery stickers.
- Receive notifications from QR scans, finder messages, possible matches, and claim decisions.
- View private information for their own reports and registered belongings.

### Administrators

- Sign in with a CSPC administrator account ending in `@cspc.edu.ph`.
- View dashboard statistics and item activity.
- Manage student and administrator accounts.
- Review claims and approve or reject them with pickup instructions or a rejection reason.
- Record physical handover acknowledgements.
- Update item status, add audit notes, archive items, and perform supported bulk actions.
- Send announcements to registered students.
- View student registered belongings and manage reports according to role permissions.

### QR recovery

A registered belonging can have a recovery QR code. A finder can scan the code and send a message without being shown the owner’s phone number or email address. The owner receives the message in the account notification inbox and, when email is configured, through email notification.

## How the system works

1. A student creates an account or an administrator creates the account from the admin panel.
2. The user signs in through the session-based authentication API.
3. The dashboard loads public item reports. Authenticated users also receive role-specific controls and notifications.
4. A student submits a lost or found report. The server validates and sanitizes the fields before saving the report.
5. Users search and filter reports. Private fields are returned only to the report owner or an administrator.
6. A student can submit a claim request for an eligible found item. An administrator reviews the request.
7. Approved claims can include pickup instructions. The administrator can later record that the physical handover was acknowledged.

## Technology stack

- Node.js
- Express 4
- Express Session with a file-backed session store
- PostgreSQL through `pg` for configured deployments
- Supabase PostgreSQL and Supabase Storage for production database and photo storage
- JSON files as the local-development data fallback when `DATABASE_URL` is not configured
- `bcryptjs` for password hashing
- `multer` for photo uploads
- `nodemailer` for email notifications
- Plain HTML, CSS, and browser JavaScript for the frontend
- Node’s built-in `node:test` runner for automated tests

## Dependencies and npm scripts

The project dependencies are declared in [`package.json`](package.json) and installed with `npm install`.

| Dependency | Purpose |
| --- | --- |
| `express` | Web server and routing framework. |
| `express-session` | Session-based authentication. |
| `session-file-store` | File-backed session storage. |
| `pg` | PostgreSQL database access. |
| `bcryptjs` | Password hashing and verification. |
| `multer` | Multipart form and image upload handling. |
| `nodemailer` | Email notifications. |
| `dotenv` | Loads local environment variables from `.env`. |
| `proxy-addr` | Proxy address handling used by Express; pinned to patched version `2.0.8`. |
| `nodemon` | Development dependency for automatic server restarts. |

Available npm scripts:

| Command | Description |
| --- | --- |
| `npm start` | Starts the production-style Node.js server. |
| `npm run dev` | Starts the server with Node’s watch mode for development. |
| `npm test` | Runs the automated test suite with Node’s built-in test runner. |
| `npm run db:import` | Imports local JSON data into the configured PostgreSQL/Supabase database. |

## Project structure

```text
.
├── server.js                 Express application and page/API wiring
├── package.json              Scripts and dependencies
├── public/                   Main frontend pages and browser assets
├── js/                       Frontend JavaScript modules
├── css/                      Shared and page-specific stylesheets
├── routes/
│   ├── authRoutes.js         Registration, login, logout, and user management
│   └── itemRoutes.js         Reports, claims, QR flows, notifications, and admin actions
├── middleware/
│   ├── auth.js               Authentication and role checks
│   └── validate.js           Input validation and sanitization
├── services/
│   ├── postgresStore.js      PostgreSQL persistence and transactions
│   ├── jsonStore.js          Local JSON persistence fallback
│   ├── supabaseStorage.js    Item photo storage
│   └── email.js              Email notifications
├── data/                     Local data and runtime storage
├── scripts/                  Data migration utilities
└── tests/                    API security and behavior tests
```

## Requirements

- Node.js 18 or newer is recommended.
- npm.
- For local fallback development: no database is required.
- For production: PostgreSQL/Supabase, persistent server storage, and a configured session secret are required.

## Installation

Clone the project, enter its directory, and install dependencies:

```bash
npm install
```

Create a local environment file from the example. Do not commit `.env`:

```bash
copy .env.example .env       # Windows PowerShell
# cp .env.example .env       # macOS/Linux
```

Replace the placeholder values in `.env` with real local or deployment values. Never place database passwords, SMTP passwords, Supabase secret keys, or `SESSION_SECRET` in frontend files.

## Environment variables

The complete list of supported variable names is in [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Use `production` for deployment. |
| `APP_BASE_URL` | Public application URL used by generated links and email content. |
| `SESSION_SECRET` | Secret used to sign session cookies. Use a long random value. Required in production. |
| `DATABASE_URL` | PostgreSQL/Supabase connection string. When set, the application uses PostgreSQL persistence. |
| `DATABASE_SSL` | Set to `false` only for a local PostgreSQL server; it defaults to SSL behavior. |
| `SUPABASE_URL` | Supabase project URL for photo storage. |
| `SUPABASE_SECRET_KEY` | Server-only Supabase storage key. The legacy `SUPABASE_SERVICE_ROLE_KEY` name is also supported. |
| `SUPABASE_STORAGE_BUCKET` | Supabase Storage bucket for item photos. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Initial administrator account settings. |
| `ADMIN_PASSWORD_RESET` | Temporarily reset the existing admin password at startup when set to `true`. Return it to `false` afterward. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Optional email delivery configuration. |
| `DATA_DIR` | Optional runtime directory for uploads and file-backed sessions. |

## Running locally

### Local JSON mode

Leave `DATABASE_URL` unset to use the JSON files under `data/` for local development. Start the application with:

```bash
npm run dev
```

Or use the normal start command:

```bash
npm start
```

Open `http://localhost:3000` in a browser. The default port can be overridden with `PORT`.

The JSON fallback is intended for development and testing. Use PostgreSQL with persistent storage for a deployed application.

### PostgreSQL/Supabase mode

Set `DATABASE_URL` and the other production values in `.env`. On startup, the application creates the required application tables when running in production or when a database connection is configured.

If existing JSON data must be imported into the configured PostgreSQL database:

```bash
npm run db:import
```

The import operation is guarded against importing the same JSON data more than once. Back up the database and verify the source files before using it in a real deployment.

## Testing

Run the automated test suite with:

```bash
npm test
```

The tests exercise API behavior, authentication, authorization, item privacy, claims, notifications, validation, and other security-sensitive flows. Tests use temporary data and should not be run against production data.

## HTTP routes

The frontend is served from the root application. Important page routes include:

| Route | Purpose |
| --- | --- |
| `/` | Student/public dashboard and item report form. |
| `/login` | Login and student registration. |
| `/admin.html` | Administrator dashboard; requires an administrator session. |
| `/found` | QR finder flow. |
| `/match-reference` | Match-reference flow. |
| `/report-lost.html` | Redirects to the lost-report form on the dashboard. |
| `/report-found.html` | Redirects to the found-report form on the dashboard. |

API routes are grouped under `/api/auth` and `/api/items`. They include authentication, reports, statistics, claims, QR lookup, anonymous finder messages, notifications, registered belongings, user management, announcements, and administrator audit actions. Protected endpoints enforce the current session and, where required, the administrator role.

## Security notes

- Passwords are stored as bcrypt hashes, never as plain text.
- Sessions use an HTTP-only cookie named `cspc.sid` and are destroyed on logout.
- Student and administrator accounts use separate CSPC email domains.
- Server-side validation and sanitization are applied to authentication and item-report input.
- Role-based middleware protects administrator actions.
- Registered belongings and private item fields are isolated by owner or administrator permissions.
- QR finder lookup intentionally omits the owner’s phone number and email address.
- Uploads are size-limited and photo access is checked before private photos are served.
- Production requires `SESSION_SECRET`, HTTPS-compatible secure cookies, database configuration, and persistent storage.
- Keep `.env`, session files, uploads, database credentials, and Supabase secret keys out of source control.
- Review dependencies regularly with `npm audit`. Keep patched versions in `package.json` and `package-lock.json`; for example, `proxy-addr` is pinned to the patched `2.0.8` release.

## Production checklist

- Set `NODE_ENV=production`.
- Set a long, random `SESSION_SECRET`.
- Configure PostgreSQL/Supabase with `DATABASE_URL` and `DATABASE_SSL`.
- Configure Supabase Storage for persistent item photos.
- Use a persistent `DATA_DIR` if file-backed sessions or temporary uploads are used.
- Set a strong initial `ADMIN_PASSWORD`, then change it after the first login.
- Configure SMTP if email notifications are required.
- Run `npm install` from the committed lockfile.
- Run `npm test` before deployment.
- Run the production server with `npm start`.
- Confirm the deployment uses HTTPS and that secrets are supplied through the hosting provider’s environment settings.

## License

This project is marked `UNLICENSED` in `package.json` and is intended for the CSPC Student Development Team.
