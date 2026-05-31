import { useEffect, useRef, useState, useCallback } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { io, Socket } from "socket.io-client";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
const socket: Socket = io("https://codesync-server-o3km.onrender.com", {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

function getUserColor(username: string): string {
  const colors = [
    "#FF6B6B", "#4ECDC4", "#45B7D1",
    "#96CEB4", "#FFEAA7", "#DDA0DD",
    "#F0A500", "#E17055"
  ];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + hash;
  }
  return colors[hash % colors.length];
}

function App() {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const roomIdRef = useRef("");
  const usernameRef = useRef("");
  const ydocRef = useRef<Y.Doc>(new Y.Doc());
  const bindingRef = useRef<MonacoBinding | null>(null);

  const cursorsRef = useRef<Map<string, {
    line: number;
    column: number;
    color: string;
    decorationId: string[];
  }>>(new Map());
  
  const handleRun = () => {
  const code = editorRef.current?.getValue();
  if (!code) return;
  setIsRunning(true);
  socket.emit("run-code", {
    roomId: roomIdRef.current,
    code,
    language,
    stdin
  });
};
  const [screen, setScreen] = useState<"lobby" | "editor">("lobby");
  const [roomInput, setRoomInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [stdin, setStdin] = useState("");
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [language, setLanguage] = useState("javascript");
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [roomId, setRoomId] = useState("");
  const [output, setOutput] = useState<string>("");
  const [isError, setIsError] = useState<boolean>(false);
  const [showOutput, setShowOutput] = useState<boolean>(false);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState<{ username: string; message: string }[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const updateRemoteCursor = useCallback((
    username: string,
    line: number,
    column: number
  ) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const color = getUserColor(username);
    const existing = cursorsRef.current.get(username);
    const oldDecorations = existing?.decorationId ?? [];

    const styleId = `cursor-style-${username}`;
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.innerHTML = `
        .cursor-${username} {
          border-left: 2px solid ${color};
          height: 100% !important;
        }
        .cursor-label-${username}::before {
          content: "${username}";
          background: ${color};
          color: black;
          font-size: 10px;
          padding: 1px 4px;
          border-radius: 3px;
          position: absolute;
          top: -16px;
          left: 0;
          white-space: nowrap;
          z-index: 100;
        }
      `;
      document.head.appendChild(style);
    }

    const newDecorations = editor.deltaDecorations(oldDecorations, [{
      range: new monaco.Range(line, column, line, column),
      options: {
        className: `cursor-${username}`,
        beforeContentClassName: `cursor-label-${username}`,
      }
    }]);

    cursorsRef.current.set(username, {
      line, column, color,
      decorationId: newDecorations
    });
  }, []);

  useEffect(() => {
    socket.connect();

    socket.on("room-created", (newRoomId: string) => {
      setRoomId(newRoomId);
      roomIdRef.current = newRoomId;
      setScreen("editor");
    });
    socket.on("chat-message", ({ username, message }: { 
  username: string; 
  message: string 
}) => {
  setMessages(prev => [...prev, { username, message }]);
});
    socket.on("room-joined", ({ roomId: joinedRoomId, yState, users }: {
      roomId: string;
      yState: number[];
      users: string[];
    }) => {
      setRoomId(joinedRoomId);
      roomIdRef.current = joinedRoomId;

      // Apply existing room state to our Yjs doc
      if (yState.length > 0) {
        Y.applyUpdate(ydocRef.current, new Uint8Array(yState));
      }

      setOnlineUsers(users);
      setScreen("editor");
    });
    
    socket.on("code-output", ({ output, isError }: { 
  output: string; 
  isError: boolean 
}) => {
  setOutput(output);
  setIsError(isError);
  setShowOutput(true);
  setIsRunning(false);
});
    socket.on("join-error", (message: string) => {
      setError(message);
    });

    // Receive Yjs update from another user
    socket.on("yjs-update", (update: number[]) => {
      Y.applyUpdate(ydocRef.current, new Uint8Array(update));
    });

    socket.on("cursor-move", ({ username, line, column }: {
      username: string;
      line: number;
      column: number;
    }) => {
      updateRemoteCursor(username, line, column);
    });

    socket.on("users-updated", (users: string[]) => {
      setOnlineUsers(users);
      cursorsRef.current.forEach((_, username) => {
        if (!users.includes(username)) {
          const existing = cursorsRef.current.get(username);
          if (existing) {
            editorRef.current?.deltaDecorations(existing.decorationId, []);
            cursorsRef.current.delete(username);
          }
        }
      });
    });

    socket.on("language-change", (newLanguage: string) => {
      monacoRef.current?.editor.setModelLanguage(
        editorRef.current?.getModel(),
        newLanguage
      );
      setLanguage(newLanguage);
    });

    return () => {
      socket.off("room-created");
      socket.off("room-joined");
      socket.off("join-error");
      socket.off("yjs-update");
      socket.off("cursor-move");
      socket.off("users-updated");
      socket.off("language-change");
      socket.off("code-output");
      socket.off("chat-message");
    };
  }, [updateRemoteCursor]);
  const handleSendMessage = () => {
  if (!messageInput.trim()) return;
  socket.emit("chat-message", {
    roomId: roomIdRef.current,
    username: usernameRef.current,
    message: messageInput
  });
  setMessageInput("");
};
  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Connect Yjs to Monaco — this is the magic line!
    // MonacoBinding watches Y.Text and Monaco simultaneously
    // Any change in one → instantly reflected in the other
    const ytext = ydocRef.current.getText("monaco");
    bindingRef.current = new MonacoBinding(
      ytext,
      editor.getModel()!,
      new Set([editor])
    );

    // When Yjs doc changes locally → send update to server
    ydocRef.current.on("update", (update: Uint8Array) => {
      socket.emit("yjs-update", {
        roomId: roomIdRef.current,
        update: Array.from(update)
      });
    });

    // Cursor tracking
    editor.onDidChangeCursorPosition((e) => {
      socket.emit("cursor-move", {
        roomId: roomIdRef.current,
        username: usernameRef.current,
        line: e.position.lineNumber,
        column: e.position.column
      });
    });
  };

  const handleLanguageChange = (newLanguage: string) => {
    monacoRef.current?.editor.setModelLanguage(
      editorRef.current?.getModel(),
      newLanguage
    );
    setLanguage(newLanguage);
    socket.emit("language-change", {
      roomId: roomIdRef.current,
      language: newLanguage
    });
  };

  const handleCreate = () => {
    if (!roomInput.trim() || !passwordInput.trim() || !usernameInput.trim()) {
      setError("Please fill all fields");
      return;
    }
    usernameRef.current = usernameInput;
    setError("");
    socket.emit("create-room", {
      roomId: roomInput.toUpperCase(),
      password: passwordInput,
      username: usernameInput
    });
  };

  const handleJoin = () => {
    if (!roomInput.trim() || !passwordInput.trim() || !usernameInput.trim()) {
      setError("Please fill all fields");
      return;
    }
    usernameRef.current = usernameInput;
    setError("");
    socket.emit("join-room", {
      roomId: roomInput.toUpperCase(),
      password: passwordInput,
      username: usernameInput
    });
  };

  if (screen === "lobby") {
    return (
      <div style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#1e1e1e",
        color: "white",
        gap: "16px"
      }}>
        <h1 style={{ marginBottom: "24px" }}>Collaborative Editor</h1>
        <input
          placeholder="Your username"
          value={usernameInput}
          onChange={e => setUsernameInput(e.target.value)}
          style={inputStyle}
        />
        <input
          placeholder="Room name"
          value={roomInput}
          onChange={e => setRoomInput(e.target.value)}
          style={inputStyle}
        />
        <input
          placeholder="Password"
          type="password"
          value={passwordInput}
          onChange={e => setPasswordInput(e.target.value)}
          style={inputStyle}
        />
        {error && <p style={{ color: "red" }}>{error}</p>}
        <div style={{ display: "flex", gap: "12px" }}>
          <button onClick={handleCreate} style={buttonStyle}>
            Create New Room
          </button>
          <button onClick={handleJoin} style={buttonStyle}>
            Join Room
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden"
    }}>
      <div style={{
        padding: "10px 20px",
        background: "#1e1e1e",
        color: "white",
        display: "flex",
        gap: "24px",
        alignItems: "center",
        flexShrink: 0
      }}>
        <span>Collaborative Editor</span>
        <span style={{ color: "#888" }}>
          Room: <strong style={{ color: "white" }}>{roomId}</strong>
        </span>
        <select
          value={language}
          onChange={e => handleLanguageChange(e.target.value)}
          style={{
            background: "#2d2d2d",
            color: "white",
            border: "1px solid #444",
            borderRadius: "6px",
            padding: "4px 8px",
            fontSize: "13px",
            cursor: "pointer"
          }}
        >
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
          <option value="python">Python</option>
          <option value="java">Java</option>
          <option value="cpp">C++</option>
          <option value="rust">Rust</option>
          <option value="go">Go</option>
        </select>

        <button
  onClick={handleRun}
  disabled={isRunning}
  style={{
    padding: "4px 16px",
    borderRadius: "6px",
    border: "none",
    background: isRunning ? "#333" : "#4CAF50",
    color: isRunning ? "#888" : "white",
    cursor: isRunning ? "not-allowed" : "pointer",
    fontSize: "13px",
    fontWeight: "bold"
  }}
> {isRunning ? "⏳ Running..." : "▶ Run"}

</button>
        <button
  onClick={() => setShowChat(prev => !prev)}
  style={{
    padding: "4px 16px",
    borderRadius: "6px",
    border: "none",
    background: showChat ? "#555" : "#0078d4",
    color: "white",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "bold"
  }}
>
  {showChat ? "Hide Chat" : "💬 Chat"}
</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          {onlineUsers.map((user, index) => (
            <div key={index} style={{
              background: getUserColor(user),
              padding: "4px 10px",
              borderRadius: "12px",
              fontSize: "12px",
              color: "black",
              fontWeight: "bold"
            }}>
              {user}
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "row", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <Editor
              height="100%"
              defaultLanguage="javascript"
              defaultValue=""
              onMount={handleEditorMount}
              theme="vs-dark"
            />
          </div>
          <div style={{
  background: "#1a1a1a",
  borderTop: "1px solid #333",
  padding: "8px 12px",
  display: "flex",
  alignItems: "center",
  gap: "10px",
  flexShrink: 0
}}>
  <span style={{ 
    color: "#888", 
    fontSize: "12px", 
    whiteSpace: "nowrap" 
  }}>
    stdin:
  </span>
  <input
    placeholder="Input for your program (if any)..."
    value={stdin}
    onChange={e => setStdin(e.target.value)}
    style={{
      flex: 1,
      background: "#2d2d2d",
      border: "1px solid #444",
      borderRadius: "6px",
      padding: "4px 10px",
      color: "white",
      fontSize: "12px"
    }}
  />
</div>
          {showOutput && (
            <div style={{
              height: "200px",
              background: "#0d0d0d",
              color: isError ? "#ff6b6b" : "#00ff00",
              padding: "12px 16px",
              fontFamily: "monospace",
              fontSize: "13px",
              overflowY: "auto",
              borderTop: "1px solid #333"
            }}>
              <strong>Output:</strong>
              <pre style={{ margin: "8px 0 0 0" }}>{output}</pre>
            </div>
          )}
        </div>

        {showChat && (
          <div style={{
            width: "280px",
            background: "#1a1a1a",
            borderLeft: "1px solid #333",
            display: "flex",
            flexDirection: "column",
          }}>
            <div style={{
              padding: "10px 12px",
              borderBottom: "1px solid #333",
              color: "white",
              fontWeight: "bold",
              fontSize: "13px"
            }}>
              💬 Chat
            </div>

            <div style={{
              flex: 1,
              overflowY: "auto",
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: "8px"
            }}>
              {messages.map((msg, index) => (
                <div key={index}>
                  <span style={{
                    color: getUserColor(msg.username),
                    fontWeight: "bold",
                    fontSize: "12px"
                  }}>
              {msg.username}
            </span>
            <p style={{
              margin: "2px 0 0 0",
              color: "#ccc",
              fontSize: "13px",
              wordBreak: "break-word"
            }}>
              {msg.message}
            </p>
          </div>
        ))}
      </div>

      <div style={{
        padding: "10px 12px",
        borderTop: "1px solid #333",
        display: "flex",
        gap: "8px"
      }}>
        <input
          placeholder="Type a message..."
          value={messageInput}
          onChange={e => setMessageInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSendMessage()}
          style={{
            flex: 1,
            background: "#2d2d2d",
            border: "1px solid #444",
            borderRadius: "6px",
            padding: "6px 10px",
            color: "white",
            fontSize: "13px"
          }}
        />
        <button
          onClick={handleSendMessage}
          style={{
            background: "#0078d4",
            border: "none",
            borderRadius: "6px",
            color: "white",
            padding: "6px 12px",
            cursor: "pointer",
            fontSize: "13px"
          }}
        >
          Send
        </button>
      </div>
    </div>
  )}
</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: "6px",
  border: "1px solid #444",
  background: "#2d2d2d",
  color: "white",
  width: "280px",
  fontSize: "14px"
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: "6px",
  border: "none",
  background: "#0078d4",
  color: "white",
  cursor: "pointer",
  fontSize: "14px"
};

export default App;
