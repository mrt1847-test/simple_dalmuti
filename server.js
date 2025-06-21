const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MAX_PLAYERS = 6;
let players = [];

app.use(express.static(__dirname));

io.on('connection', (socket) => {
  socket.on('join', (nickname, callback) => {
    if (players.length >= MAX_PLAYERS) {
      callback({ success: false, message: '최대 인원 초과' });
      return;
    }
    if (players.find(p => p.nickname === nickname)) {
      callback({ success: false, message: '중복 닉네임' });
      return;
    }
    const player = { id: socket.id, nickname, ready: false };
    players.push(player);
    socket.nickname = nickname;
    io.emit('players', players);
    callback({ success: true });
  });

  socket.on('ready', () => {
    const player = players.find(p => p.id === socket.id);
    if (player) player.ready = true;
    io.emit('players', players);
    if (players.length > 1 && players.length <= MAX_PLAYERS && players.every(p => p.ready)) {
      io.emit('gameStart');
    }
  });

  socket.on('disconnect', () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit('players', players);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
}); 