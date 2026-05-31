import mongoose from "mongoose";

const RoomSchema = new mongoose.Schema({
  roomId:   { type: String, required: true, unique: true },
  password: { type: String, required: true },
  yState:   { type: Buffer, default: Buffer.alloc(0) }
}, { timestamps: true });

export const Room = mongoose.model("Room", RoomSchema);
