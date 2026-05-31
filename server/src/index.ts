import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import mongoose from "mongoose";
import { Room } from "./models/Room";
import * as Y from "yjs";
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

mongoose.connect(process.env.MONGODB_URI!)
  .then(() => console.log("MongoDB connected ✅"))
  .catch(err => console.log("MongoDB error:", err));

// Room state in memory
const rooms = new Map<string, {
  yState: Uint8Array;  // Yjs document state
  password: string;
  users: Map<string, string>;
}>();

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // ─── CREATE ROOM ────────────────────────────
  socket.on("create-room", async ({ roomId, password, username }: {
    roomId: string;
    password: string;
    username: string;
  }) => {
    if (rooms.has(roomId)) {
      socket.emit("join-error", "Room name already taken");
      return;
    }

    try {
      const newRoom = new Room({ roomId, password, yState: Buffer.alloc(0) });
      await newRoom.save();
    } catch (err) {
      socket.emit("join-error", "Failed to create room");
      return;
    }

    rooms.set(roomId, {
      yState: new Uint8Array(),
      password,
      users: new Map<string, string>()
    });

    const room = rooms.get(roomId)!;
    socket.join(roomId);
    room.users.set(socket.id, username);

    socket.emit("room-created", roomId);
    socket.emit("users-updated", Array.from(room.users.values()));
    console.log(`Room created: ${roomId}`);
  });

  // ─── JOIN ROOM ──────────────────────────────
  socket.on("join-room", async ({ roomId, password, username }: {
    roomId: string;
    password: string;
    username: string;
  }) => {
    let room = rooms.get(roomId);

    if (!room) {
      try {
        const roomFromDB = await Room.findOne({ roomId });
        if (!roomFromDB) {
          socket.emit("join-error", "Room not found");
          return;
        }
        rooms.set(roomId, {
          // Convert stored Buffer back to Uint8Array
          yState: roomFromDB.yState?.length
            ? new Uint8Array(roomFromDB.yState)
            : new Uint8Array(),
          password: roomFromDB.password,
          users: new Map<string, string>()
        });
        room = rooms.get(roomId)!;
      } catch (err) {
        socket.emit("join-error", "Failed to join room");
        return;
      }
    }

    if (room.password !== password) {
      socket.emit("join-error", "Wrong password");
      return;
    }

    room.users.set(socket.id, username);
    socket.join(roomId);

    socket.emit("room-joined", {
      roomId,
      // Send existing Yjs state to new joiner
      yState: Array.from(room.yState),
      users: Array.from(room.users.values())
    });

    socket.broadcast.to(roomId).emit("users-updated",
      Array.from(room.users.values())
    );

    console.log(`User ${username} joined room ${roomId}`);
  });

  // ─── YJS UPDATE ─────────────────────────────
  // This replaces our old insert + delete handlers
  socket.on("yjs-update", async ({ roomId, update }: {
    roomId: string;
    update: number[];
  }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const updateBytes = new Uint8Array(update);

    // Merge update into room's Yjs state
    const ydoc = new Y.Doc();
    if (room.yState.length > 0) {
      Y.applyUpdate(ydoc, room.yState);
    }
    Y.applyUpdate(ydoc, updateBytes);
    room.yState = Y.encodeStateAsUpdate(ydoc);

    // Save to MongoDB
    await Room.updateOne(
      { roomId },
      { yState: Buffer.from(room.yState) }
    );

    // Broadcast to others
    socket.broadcast.to(roomId).emit("yjs-update", update);
  });
  //DISCUSSION ROOM
  socket.on("chat-message", ({ roomId, username, message }: {
  roomId: string;
  username: string;
  message: string;
}) => {
  io.to(roomId).emit("chat-message", { username, message });
});
  // ─── CURSOR ─────────────────────────────────
  socket.on("cursor-move", ({ roomId, username, line, column }: {
    roomId: string;
    username: string;
    line: number;
    column: number;
  }) => {
    socket.broadcast.to(roomId).emit("cursor-move", { username, line, column });
  });

  // ─── LANGUAGE ───────────────────────────────
  socket.on("language-change", ({ roomId, language }: {
    roomId: string;
    language: string;
  }) => {
    socket.broadcast.to(roomId).emit("language-change", language);
  });
  // RUN CODE
  socket.on("run-code", async ({ roomId, code, language, stdin }: {
  roomId: string;
  code: string;
  language: string;
  stdin: string;
}) => {
  try {
    const languageMap: Record<string, { language: string; versionIndex: string }> = {
      javascript: { language: "nodejs", versionIndex: "4" },
      typescript: { language: "typescript", versionIndex: "0" },
      python: { language: "python3", versionIndex: "4" },
      java: { language: "java", versionIndex: "4" },
      cpp: { language: "cpp17", versionIndex: "0" },
      rust: { language: "rust", versionIndex: "0" },
      go: { language: "go", versionIndex: "4" }
    };

    const lang = languageMap[language] || { language: "nodejs", versionIndex: "4" };
    console.log("stdin received:", stdin);
    const response = await fetch("https://api.jdoodle.com/v1/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: process.env.JDOODLE_CLIENT_ID,
        clientSecret: process.env.JDOODLE_CLIENT_SECRET,
        script: code,
        language: lang.language,
        versionIndex: lang.versionIndex,
        stdin: stdin ? stdin + "\n" : ""
      })
    });

    const result = await response.json() as { output: string; statusCode: number };
    console.log("JDoodle result:", JSON.stringify(result));
    const isError = result.statusCode !== 200;

    io.to(roomId).emit("code-output", {
      output: result.output || "No output",
      isError
    });

  } catch (err) {
    io.to(roomId).emit("code-output", {
      output: "Execution failed. Try again.",
      isError: true
    });
  }
});
  // ─── DISCONNECT ─────────────────────────────
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    rooms.forEach((room, roomId) => {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        io.to(roomId).emit("users-updated",
          Array.from(room.users.values())
        );
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
