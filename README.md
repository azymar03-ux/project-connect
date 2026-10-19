# ProjectConnect — The Network for Building Projects

<div align="center">

![ProjectConnect Banner](https://raw.githubusercontent.com/azymar03-ux/project-connect/main/apps/web/public/images/drone.svg)

### Where Pro Developers & Makers Ship Together

[![Next.js](https://img.shields.io/badge/Next.js-16.4-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma)](https://prisma.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Google Cloud](https://img.shields.io/badge/Google-OAuth%202.0-4285F4?style=for-the-badge&logo=google)](https://cloud.google.com/)

Pair elite Frontend design with resilient Backend architecture & Physical hardware.  
Built for software creators, AI researchers, robotics engineers, and IoT builders.

[Explore Platform](http://localhost:3000) · [Report Bug](https://github.com/azymar03-ux/project-connect/issues) · [Request Feature](https://github.com/azymar03-ux/project-connect/issues)

</div>

---

## ⚡ Core Features

- **Project Discovery & Team Matching**: Heuristic fit ranking matching makers by skills (Python, ROS, React, Arduino, ECE, AI/ML), interests, and city.
- **Supabase Cloud Infrastructure**: Full PostgreSQL relational schema with 25 migrations, connection pooling via PgBouncer, and S3-compatible cloud object storage for project covers & schematics.
- **Google OAuth & Password Authentication**: Seamless one-tap Google login with PKCE security, alongside secure salted bcrypt password authentication.
- **Hardware & Component Locator**: Built-in spatial directory for local electronics, drone component, sensor, and 3D printing hubs (Coimbatore & beyond).
- **Interactive AI Roadmap Assistant**: Synthesizes project development roadmaps, milestones, and bill-of-materials for IoT and robotics makers.
- **Developer Workspaces**: Collaborative project boards, task management, label filtering, milestone tracking, and shared file vaults.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript, Vanilla CSS Design System |
| **Backend API** | NestJS / Express REST API, Node.js 22 |
| **Database** | Supabase PostgreSQL + PostGIS (Hosted on AWS ap-southeast-1) |
| **ORM** | Prisma ORM v6.12 |
| **Cloud Storage** | Supabase Storage (S3-Compatible Object Store) |
| **Auth** | Google OAuth 2.0 (OIDC / PKCE) + Session Token Authentication |

---

## 🚀 Quickstart Guide

### 1. Clone the repository
```bash
git clone https://github.com/azymar03-ux/project-connect.git
cd project-connect
```

### 2. Install dependencies
```bash
npm install
```

### 3. Environment setup
Copy `.env.example` to `.env` and fill in your Supabase and Google OAuth credentials:
```bash
cp .env.example .env
```

### 4. Database initialization
```bash
# Push Prisma schema to your database
npm run db:push

# (Optional) Seed demo makers, projects, and hardware stores
npm run db:seed
```

### 5. Start the development servers
```bash
# Terminal 1: Start API server (port 3001)
npm run api

# Terminal 2: Start Next.js frontend (port 3000)
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to view the application.

---

## 📁 Repository Structure

```text
project-connect/
├── apps/
│   ├── api/            # NestJS / Express Backend API
│   │   ├── src/core/   # Security, S3 storage, OIDC auth, and database helpers
│   │   └── src/features/ # Projects, tasks, hardware stores, AI planner
│   └── web/            # Next.js 16 Web Application
│       ├── app/        # App Router pages and responsive views
│       └── components/ # Reusable UI components & modals
├── prisma/             # Database schema and seed scripts
└── docs/               # Architecture, API specs, and launch documentation
```

---

## 🔒 Security & Privacy

- Environment secrets (`.env`, `.env.local`) are strictly excluded from source control.
- Passwords hashed using `bcrypt` with cost factor 12.
- File uploads validated for MIME-type, bounded size (5MB), and stored with cryptographic keys.
- Cookie-based session tokens with `HttpOnly`, `SameSite=Lax`, and `Secure` flags.

---

## 📄 License

This project is licensed under the MIT License.
