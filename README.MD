# CodeSync — Real-time Collaborative Code Editor

A production-grade collaborative code editor where multiple developers can write, run, and discuss code together in real time — built from scratch with WebSockets, CRDT, and Monaco Editor.

---

## Features

- **Real-time collaboration** — multiple users edit the same file simultaneously with zero conflicts
- **CRDT-based sync** — built a custom CRDT implementation from scratch to understand distributed consistency theory, then migrated to Yjs for production reliability
- **Code execution** — run code in 7 languages and see output instantly across all users in the room
- **Stdin support** — provide program input before running
- **Live cursors** — see every collaborator's cursor position with username labels in real time
- **Room system** — create or join password-protected rooms
- **Live chat** — discuss code with collaborators in a side panel
- **Session persistence** — room content survives server restarts via Yjs binary state stored in MongoDB
- **Auto-reconnection** — exponential backoff reconnection handles network drops gracefully

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite | Type safety, fast dev server |
| Editor | Monaco Editor | Same engine as VS Code |
| Real-time | Socket.io WebSockets | Persistent bidirectional connection vs REST polling |
| CRDT | Yjs + y-monaco | Production-grade conflict-free sync; MonacoBinding connects Y.Text to Monaco automatically |
| Backend | Node.js + Express | Non-blocking I/O suits real-time workloads |
| Database | MongoDB Atlas | Flexible schema for storing Yjs binary state |
| Code Execution | JDoodle API (proxied) | Isolated execution environment; API key protected server-side |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Client (React)                    │
│  Monaco Editor ←→ MonacoBinding ←→ Y.Doc (Yjs)     │
│                         ↕ binary updates             │
│                    Socket.io Client                  │
└──────────────────────────┬──────────────────────────┘
                           │ WebSocket
┌──────────────────────────▼──────────────────────────┐
│               Server (Node.js + Express)             │
│  Socket.io Server → broadcasts Yjs updates to room  │
│  Merges Yjs state → persists to MongoDB             │
│  Proxies code execution → JDoodle API               │
└──────────────┬──────────────────────────┬───────────┘
               │                          │
     MongoDB Atlas                   JDoodle API
  (Yjs binary state)            (isolated execution)
```

---

## Key Technical Decisions

**Why WebSockets over REST?**
Collaborative editing requires the server to push changes to all clients instantly. REST is request-response — it can't push. WebSockets maintain a persistent connection, enabling sub-100ms sync latency.

**Why CRDT instead of locking?**
Locking one user out while another types breaks the collaborative experience. CRDTs allow all users to type simultaneously and guarantee eventual consistency — every client converges to the same document state without coordination.

**Why proxy code execution through the server?**
Calling JDoodle directly from the frontend would expose the API key in browser devtools. The server acts as a proxy — the API key lives only in environment variables on the server.

**Why store Yjs binary state instead of plain text?**
Yjs encodes the full CRDT history in a compact binary format. When a new user joins, the server sends this binary state and Yjs reconstructs the exact document — including all unresolved concurrent operations — in one step.

---

## Supported Languages

JavaScript, TypeScript, Python, Java, C++, Rust, Go

---

## Local Setup

```bash
# Clone the repo
git clone https://github.com/Prahana21/collaborative-editor
cd collaborative-editor

# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install

# Create server/.env
MONGODB_URI=your_mongodb_connection_string
JDOODLE_CLIENT_ID=your_jdoodle_client_id
JDOODLE_CLIENT_SECRET=your_jdoodle_client_secret

# Run server (from /server)
npm run dev

# Run client (from /client)
npm run dev
```

Open `http://localhost:5173`, create a room, and open a second tab to test collaboration.

---

## What I Learned

- Built a CRDT from scratch using unique IDs, after-pointers, and tombstoning before adopting Yjs — understanding the theory before the abstraction
- Learned why the closure problem in React requires `useRef` instead of `useState` for values used inside Socket.io event listeners
- Understood why `socket.broadcast` vs `io.to()` matters — sending your own update back to yourself causes double-application of changes
- Designed a proxy pattern to protect third-party API credentials

---

**Live demo:** https://codesync-client-qxpi.onrender.com
