# AI Assistance Disclosure

**Project:** CSPC Lost & Found Management System  
**Course:** Application Development (Midterm Project — Round 1)  
**Date:** September 2026

---

## Declaration

This document formally discloses the use of artificial intelligence (AI) tools during the development of the CSPC Lost & Found Management System, in compliance with the course midterm project rubric requirements.

---

## AI Tools Used

| Tool | Purpose | Scope of Use |
| :--- | :--- | :--- |
| **Google Gemini / Antigravity** | Code generation, architectural guidance, and documentation drafting | Assisted with Express.js route scaffolding, middleware design patterns, input validation logic, frontend-backend integration, and documentation authoring |

---

## Specific Areas of AI Assistance

### 1. Backend Architecture

AI was consulted for structuring the Express.js application following RESTful conventions, including:
- Route modularization (`routes/authRoutes.js`, `routes/itemRoutes.js`)
- Middleware separation (`middleware/auth.js`, `middleware/validate.js`)
- Session-based authentication flow with `express-session`

### 2. Security Implementation

AI provided guidance on:
- Password hashing with `bcryptjs` (salt rounds, async hash/compare patterns)
- Session cookie configuration (`httpOnly`, `maxAge` settings)
- Input sanitization strategy (stripping HTML/script tags server-side)

### 3. Smart Match Algorithm

The keyword-based matching algorithm (`findMatch` in `itemRoutes.js`) was developed with AI assistance for:
- Stop word filtering logic
- Multi-criteria matching (keyword overlap, category match, location proximity)

### 4. Frontend Integration

AI assisted with:
- Fetch API patterns for connecting the HTML frontend to Express API endpoints
- Dynamic DOM manipulation for login state, role-aware UI elements, and item rendering
- Print-friendly claim slip generation using CSS `@media print`

### 5. Documentation

AI assisted in drafting:
- `REQUIREMENTS.md` (stakeholders, functional/non-functional requirements, use cases)
- `DEFENSE_GUIDE.md` (presentation structure and critique matrix)
- This `AI_DISCLOSURE.md` document

---

## Human Contributions

The following aspects were primarily human-driven:

1. **Problem identification** — Identifying the real campus need for a digital lost-and-found system at CSPC
2. **Requirements gathering** — Defining stakeholders based on actual CSPC organizational structure
3. **Campus data sourcing** — Official CSPC office and location names sourced from [cspc.edu.ph/offices/](https://cspc.edu.ph/offices/)
4. **Design decisions** — Selection of the dark/yellow color scheme, CSPC branding, and UI layout
5. **Testing and validation** — Manual end-to-end testing of all user flows
6. **Iterative refinement** — All AI-generated code was reviewed, tested, modified, and integrated by the team

---

## Ethical Statement

We affirm that:

- All AI-generated output was critically reviewed and understood before integration.
- We can explain and defend every component of this system during the project showcase.
- AI tools were used as a development accelerator, not as a substitute for learning.
- This disclosure is made in good faith and in full compliance with the CSPC academic integrity policy.

---

**Signed by:** CSPC Student Development Team  
**Date:** September 2026

