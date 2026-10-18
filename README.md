# QRush ⚡
> High-Concurrency Virtual Waiting Room & Atomic Reservation Engine

## Project Structure
```
qrush/
├── docker-compose.yml       # PostgreSQL 16 & Redis 7 services
├── backend/                 # Java 21 + Spring Boot 3.3.x (com.qrush)
│   ├── src/main/java/com/qrush/
│   │   ├── QRushApplication.java
│   │   └── controller/HealthController.java
│   ├── src/main/resources/application.properties
│   └── mvnw.cmd
└── frontend/                # React 18 + TypeScript + Tailwind CSS v4 (Vite)
    ├── src/
    │   ├── App.tsx
    │   └── index.css        # @import "tailwindcss";
    └── vite.config.ts
```

## Quick Start

### 1. Start Infrastructure (PostgreSQL & Redis)
In the root `qrush/` directory:
```bash
docker compose up -d
```

### 2. Start Backend (Spring Boot)
In `backend/`:
```powershell
.\mvnw.cmd spring-boot:run
```
Backend runs at: `http://localhost:8080` (Health check: `/api/health`)

### 3. Start Frontend (React + Vite)
In `frontend/`:
```bash
npm run dev
```
Frontend runs at: `http://localhost:3000` (auto-proxies `/api` to port 8080)
