// ════════════════════════════════════════════════
//  Minecraft Touch - Multiplayer Relay Server
//  Replit用 (Node.js + socket.io)
// ════════════════════════════════════════════════
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 5e6 // ワールドデータ(約350KB)を送れるように
});

// ── ヘルスチェック用ページ
app.get('/', (req, res) => {
  res.send('Minecraft Touch Multiplayer Server is running.');
});

// rooms[code] = { hostId, players: { [socketId]: {x,y,z,yaw,name} } }
const rooms = {};

const CODE_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms[code]); // 重複防止
  return code;
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  // ── ルーム作成（ホスト）
  socket.on('createRoom', () => {
    const code = generateRoomCode();
    rooms[code] = { hostId: socket.id, players: {} };
    socket.data.roomCode = code;
    socket.data.isHost = true;
    socket.join(code);
    socket.emit('roomCreated', { code });
    console.log(`room created: ${code} by ${socket.id}`);
  });

  // ── ルーム参加
  socket.on('joinRoom', ({ code }) => {
    code = (code || '').toLowerCase().trim();

    if (!code) {
      socket.emit('joinResult', { ok: false, error: 'コードが入力されていません' });
      return;
    }
    if (!/^[a-z0-9]{6}$/.test(code)) {
      socket.emit('joinResult', { ok: false, error: 'コードの形式が正しくありません' });
      return;
    }
    const room = rooms[code];
    if (!room) {
      socket.emit('joinResult', { ok: false, error: 'そのコードのワールドは見つかりませんでした' });
      return;
    }

    socket.data.roomCode = code;
    socket.data.isHost = false;
    socket.join(code);
    room.players[socket.id] = { x: 0, y: 0, z: 0, yaw: 0 };

    // ホストへワールドデータをリクエスト
    io.to(room.hostId).emit('worldRequest', { requesterId: socket.id });

    // 参加成功を通知（ワールドデータは別途 'worldData' で届く）
    socket.emit('joinResult', { ok: true, code });

    // 既存プレイヤー一覧を送る
    socket.emit('playerList', room.players);

    // 他プレイヤーに新規参加を通知
    socket.to(code).emit('playerJoined', { id: socket.id });

    console.log(`${socket.id} joined room ${code}`);
  });

  // ── ホストからワールドデータ受信 → 該当プレイヤーへ転送
  socket.on('worldData', ({ requesterId, buffer }) => {
    io.to(requesterId).emit('worldData', { buffer });
  });

  // ── ブロック変更の同期
  socket.on('blockChange', (data) => {
    const code = socket.data.roomCode;
    if (!code) return;
    socket.to(code).emit('blockChange', data);
  });

  // ── プレイヤー位置の同期
  socket.on('playerUpdate', (data) => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    rooms[code].players[socket.id] = data;
    socket.to(code).emit('playerUpdate', { id: socket.id, ...data });
  });

  // ── 切断処理
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (code && rooms[code]) {
      delete rooms[code].players[socket.id];
      socket.to(code).emit('playerLeft', { id: socket.id });

      // ホストが抜けたらルーム削除
      if (rooms[code].hostId === socket.id) {
        io.to(code).emit('hostLeft');
        delete rooms[code];
        console.log(`room ${code} closed (host left)`);
      }
    }
    console.log('disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
