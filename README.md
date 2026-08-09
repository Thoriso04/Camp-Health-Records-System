Set-Content -Path README.md -Value @"
# Camp Health Records System (CHRS)

The **Camp Health Records System (CHRS)** is a custom-built, offline-first desktop application designed for the Just Footprints Foundation. It digitizes paper-based medical records, medication check-ins, MedShack visit logs, and near-miss incident reports across 5 provincial camp sites.

The application operates completely offline on Windows laptops, ensuring POPIA compliance through local AES-256 database encryption (SQLCipher) and role-based access control.

---

## Tech Stack

* **Desktop Shell:** Electron LTS
* **Frontend UI:** React 18, Tailwind CSS 3.x
* **Runtime & Logic:** Node.js 20 LTS
* **Database & Encryption:** SQLite + SQLCipher (AES-256 via \`better-sqlite3\`)
* **Testing:** Jest, Playwright

---

## Getting Started

### Prerequisites
* **Node.js**: v20 LTS
* **npm**: v9+
* **OS**: Windows 10 or 11

### Installation & Local Setup

1. **Clone the repository:**
   \`\`\`bash
   git clone https://github.com/Thoriso04/Camp-Health-Records-System.git
   cd Camp-Health-Records-System
   \`\`\`

2. **Install dependencies:**
   \`\`\`bash
   npm install
   \`\`\`

3. **Run the application in development mode:**
   \`\`\`bash
   npm run dev
   \`\`\`

4. **Run Test Suites:**
   \`\`\`bash
   npm test
   \`\`\`

---

## Security & POPIA Features

* **Offline-First Execution:** Zero internet dependency for any core clinical feature.
* **Encryption at Rest:** Full database file encrypted using AES-256 SQLCipher.
* **Role-Based Access Control (RBAC):** Restricts interface capabilities based on user roles (Camp Physician, Nurse, Paramedic, Administrator).
* **Audit Logging:** Append-only, encrypted event tracking for compliance and record modifications.
"@