const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // 모든 출처에서의 연결을 허용합니다.
    methods: ["GET", "POST"]
  }
});

const MAX_PLAYERS = 6;
let players = [];

// --- 전역 게임 상태 변수 ---
let ordered = [];
let turnIdx = 0;
let lastPlay = null;
let passes = 0;
let playerHands = [];
let finished = [];
let finishOrder = [];
let gameCount = 1;
let lastGameScores = [];
let totalScores = [];
let gameInProgress = false;
// --------------------------

app.use(express.static(__dirname));

// 메인 진입 시 index.html로 리다이렉트
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// lobby.html, game.html 접근 시 파일이 없으면 join.html로 리다이렉트 (프론트 localStorage 기반)
app.get('/lobby', (req, res) => {
  res.sendFile(path.join(__dirname, 'lobby.html'));
});
app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'game.html'));
});
// 기타 없는 경로는 join.html로
app.use((req, res) => {
  res.redirect('/join.html');
});

// 게임 시작 조건 함수 (전역으로 이동)
function startGameIfReady() {
  if (gameInProgress) return; // 이미 게임이 시작되었다면 중복 실행 방지

  if (players.length > 1 && players.length <= MAX_PLAYERS && players.every(p => p.ready)) {
    console.log('게임 시작 조건 충족! 데이터 준비 중...');
    gameInProgress = true;
    
    // 1. 숫자 뽑기
    const numbers = [];
    while (numbers.length < players.length) {
      const n = Math.floor(Math.random() * 12) + 1;
      if (!numbers.includes(n)) numbers.push(n);
    }
    
    // 2. 신분 및 순서 배정
    let picked = players.map((p, i) => ({ id: p.id, nickname: p.nickname, card: numbers[i] }));
    const roles = ['달무티', '대주교', '평민', '평민', '광부', '노예'].slice(0, players.length);
    picked.sort((a, b) => a.card - b.card);
    ordered = picked.map((p, i) => ({ ...p, role: roles[i] }));

    // 3. 게임 상태 초기화
    turnIdx = 0;
    lastPlay = null;
    passes = 0;
    finished = Array(ordered.length).fill(false);
    finishOrder = [];
    gameCount = 1;
    lastGameScores = Array(ordered.length).fill(0);
    totalScores = Array(ordered.length).fill(0);

    // 4. 카드 분배 및 저장
    const deck = [];
    for (let i = 1; i <= 12; i++) {
      for (let j = 0; j < i; j++) deck.push(i);
    }
    deck.push('J', 'J'); // 조커 2장

    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    
    // 올바른 카드 분배: 각 플레이어에게 13장씩
    const hands = Array(ordered.length).fill(0).map(_ => []);
    const cardsPerPlayer = 13;
    
    // 각 플레이어에게 13장씩 분배
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < cardsPerPlayer; j++) {
        hands[i].push(deck[i * cardsPerPlayer + j]);
      }
    }
    
    // 남은 카드(2장)는 달무티에게
    const dalmutiIdx = ordered.findIndex(p => p.role === '달무티');
    if (dalmutiIdx !== -1) {
      const remainingCards = deck.slice(ordered.length * cardsPerPlayer);
      hands[dalmutiIdx].push(...remainingCards);
    }
    
    playerHands = hands.map(h => h.slice());
    
    // 디버그: 각 플레이어의 카드 수 확인
    console.log('카드 분배 완료:');
    ordered.forEach((p, i) => {
      console.log(`${p.nickname} (${p.role}): ${playerHands[i].length}장`);
    });

    // 5. 클라이언트들에게 게임 페이지로 이동하라고 알림
    io.emit('gameStart');
    console.log('gameStart 이벤트 전송. 클라이언트들이 game.html로 이동합니다.');
  }
}

io.on('connection', (socket) => {
  socket.on('join', (nickname, callback) => {
    socket.nickname = nickname;

    // --- 게임 재접속 및 데이터 전송 로직 ---
    if (gameInProgress) {
      const playerIndex = ordered.findIndex(p => p.nickname === nickname);
      if (playerIndex !== -1) {
        console.log(`게임 참가자 ${nickname}가 game.html에 연결했습니다.`);
        
        // 새로운 소켓 ID로 플레이어 정보 업데이트
        ordered[playerIndex].id = socket.id;
        const playerInLobbyList = players.find(p => p.nickname === nickname);
        if (playerInLobbyList) playerInLobbyList.id = socket.id;

        // 해당 플레이어에게 게임 데이터 전송
        io.to(socket.id).emit('gameSetup', {
          ordered: ordered,
          myCards: playerHands[playerIndex],
          turnInfo: { turnIdx: 0, currentPlayer: ordered[0] },
          field: null
        });
        console.log(`${nickname}에게 gameSetup 데이터 전송 완료.`);
        return callback({ success: true, inGame: true });
      }
    }

    // --- 로비 입장 로직 ---
    // 중복 닉네임 처리 (이미 로비에 있는 경우 소켓 ID만 업데이트)
    const existingPlayer = players.find(p => p.nickname === nickname);
    if (existingPlayer) {
      existingPlayer.id = socket.id;
    } else {
      if (players.length >= MAX_PLAYERS) {
        return callback({ success: false, message: '최대 인원 초과' });
      }
      players.push({ id: socket.id, nickname, ready: false });
    }
    
    io.emit('players', players);
    callback({ success: true });
  });

  socket.on('ready', () => {
    const player = players.find(p => p.id === socket.id);
    if (player) player.ready = true;
    io.emit('players', players);
    startGameIfReady();
  });

  socket.on('unready', () => {
    const player = players.find(p => p.id === socket.id);
    if (player) player.ready = false;
    io.emit('players', players);
  });

  socket.on('chat', (msg) => {
    io.emit('chat', {nickname: socket.nickname, msg});
  });

  socket.on('disconnect', () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit('players', players);
    // TODO: 게임 중 나갔을 때 처리
  });

  // --- 인게임 플레이 로직 ---
  socket.on('playCards', (cards, cb) => {
    const idx = ordered.findIndex(p => p.id === socket.id);

    if (!gameInProgress || idx !== turnIdx || finished[idx]) {
      return cb && cb({success: false, message: '당신의 차례가 아니거나, 게임이 진행중이 아닙니다.'});
    }
    
    // 유효성 검사
    const hand = playerHands[idx];
    let num = null;
    let jokerCount = cards.filter(c => c === 'J').length;
    
    if (cards.length === 0) return cb && cb({success: false, message: '카드를 선택해주세요.'});
    
    for (const c of cards) {
      if (hand.indexOf(c) === -1) return cb && cb({success: false, message: '손패에 없는 카드를 제출했습니다.'});
      if (c !== 'J') {
        if (num === null) num = c;
        else if (c !== num) return cb && cb({success: false, message: '같은 숫자 또는 조커만 함께 제출할 수 있습니다.'});
      }
    }
    
    if (jokerCount === cards.length) num = 13; // 조커만 낼 경우 숫자 13으로 취급
    
    if (lastPlay) {
      if (cards.length !== lastPlay.count) return cb && cb({success: false, message: `이전과 같은 ${lastPlay.count}장만 낼 수 있습니다.`});
      if (num >= lastPlay.number) return cb && cb({success: false, message: '이전보다 낮은 숫자만 낼 수 있습니다.'});
    }
    
    // 제출 처리
    cards.forEach(c => hand.splice(hand.indexOf(c), 1));
    lastPlay = {count: cards.length, number: num, playerIdx: idx};
    passes = 0;
    
    if (hand.length === 0) {
      finished[idx] = true;
      finishOrder.push(idx);
    }
    
    io.emit('playResult', {playerIdx: idx, cards, lastPlay, finished});
    cb && cb({success: true});

    // 게임 종료 체크
    const finishedCount = finished.filter(f => f).length;
    console.log(`게임 진행 상황: ${finishedCount}/${players.length} 완주`);
    
    if (finishedCount >= players.length) { // 모든 플레이어가 완주했을 때만 게임 종료
      console.log('모든 플레이어가 완주했습니다! 게임 종료.');
      
      const scores = [10, 8, 6, 5, 4, 3].slice(0, players.length);
      const result = finishOrder.map((playerIdx, i) => {
        lastGameScores[playerIdx] = scores[i] || 0;
        totalScores[playerIdx] = (totalScores[playerIdx] || 0) + lastGameScores[playerIdx];
        return {
          nickname: ordered[playerIdx].nickname,
          role: ordered[playerIdx].role,
          score: lastGameScores[playerIdx],
          total: totalScores[playerIdx]
        }
      });
      
      console.log('게임 종료! 최종 결과:', result);
      io.emit('gameEnd', result);
      
      gameInProgress = false; // 한 판 종료
      players.forEach(p => p.ready = false); // 레디 상태 초기화
      io.emit('players', players);
      
      // TODO: 5판 끝나면 최종 우승자 발표 및 다음 게임 준비 로직
      return;
    }
    
    // 다음 턴
    do {
      turnIdx = (turnIdx + 1) % ordered.length;
    } while (finished[turnIdx]);
    
    io.emit('turnChanged', { turnIdx, currentPlayer: ordered[turnIdx] });
  });
  
  socket.on('passTurn', (cb) => {
    const idx = ordered.findIndex(p => p.id === socket.id);
    if (!gameInProgress || idx !== turnIdx || finished[idx]) return;
    
    passes++;
    io.emit('passResult', {playerIdx: idx, passes});
    
    // 모두 패스 -> 라운드 리셋
    if (passes >= players.length - finished.filter(f => f).length - 1) {
      passes = 0;
      // 마지막으로 카드를 낸 사람이 턴을 잡음
      if (lastPlay) {
        turnIdx = lastPlay.playerIdx;
      }
      // lastPlay가 null이면 (라운드 첫 턴에 모두 패스하는 비정상적 상황) 현재 턴 유지
      lastPlay = null;
      io.emit('newRound', {turnIdx, lastPlay: null, currentPlayer: ordered[turnIdx]});
    } else {
      do {
        turnIdx = (turnIdx + 1) % ordered.length;
      } while (finished[turnIdx]);
      io.emit('turnChanged', { turnIdx, currentPlayer: ordered[turnIdx] });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
}); 