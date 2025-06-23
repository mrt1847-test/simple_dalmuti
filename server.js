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

// --- 게임 상태를 하나의 객체로 관리 ---
let game = {
  inProgress: false,
  ordered: [],
  turnIdx: 0,
  lastPlay: null,
  passes: 0,
  playerHands: [],
  finished: [],
  finishOrder: [],
  gameCount: 1,
  lastGameScores: [],
  totalScores: []
};
// ------------------------------------

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

function resetGame() {
  game = {
    inProgress: false,
    ordered: [],
    turnIdx: 0,
    lastPlay: null,
    passes: 0,
    playerHands: [],
    finished: [],
    finishOrder: [],
    gameCount: 1,
    lastGameScores: [],
    totalScores: []
  };
  players.forEach(p => p.ready = false);
  io.emit('players', players);
}

function startGameIfReady() {
  if (game.inProgress) return;

  if (players.length > 1 && players.length <= MAX_PLAYERS && players.every(p => p.ready)) {
    console.log('게임 시작 조건 충족! 데이터 준비 중...');
    game.inProgress = true;
    
    // 1. 숫자 뽑기
    const numbers = [];
    while (numbers.length < players.length) {
      const n = Math.floor(Math.random() * 12) + 1;
      if (!numbers.includes(n)) numbers.push(n);
    }
    
    // 2. 신분 및 순서 배정
    let picked = players.map((p, i) => ({ id: p.id, nickname: p.nickname, card: 0 }));
    picked.forEach((p,i) => p.card = numbers[i]);
    
    const roles = ['달무티', '대주교', '평민', '평민', '광부', '노예'].slice(0, players.length);
    picked.sort((a, b) => a.card - b.card);
    game.ordered = picked.map((p, i) => ({ ...p, role: roles[i] }));

    // 3. 게임 상태 초기화
    game.turnIdx = 0;
    game.lastPlay = null;
    game.passes = 0;
    game.finished = Array(game.ordered.length).fill(false);
    game.finishOrder = [];
    // gameCount, lastGameScores, totalScores는 게임이 완전히 끝날 때 초기화하거나 다음 라운드 시작 시 해야 함

    // 4. 카드 분배 및 저장
    const deck = [];
    for (let i = 1; i <= 12; i++) {
      for (let j = 0; j < i; j++) deck.push(i);
    }
    deck.push('J', 'J');

    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    
    const hands = Array(game.ordered.length).fill(null).map(() => []);
    let cardDealIndex = 0;
    
    // 13장씩 라운드-로빈 방식으로 분배
    for (let i = 0; i < 13; i++) {
      for (let j = 0; j < game.ordered.length; j++) {
        if(deck[cardDealIndex]) {
          hands[j].push(deck[cardDealIndex++]);
        }
      }
    }

    const dalmutiIdx = game.ordered.findIndex(p => p.role === '달무티');
    if (dalmutiIdx !== -1) {
      while(cardDealIndex < deck.length) {
        if(deck[cardDealIndex]) {
          hands[dalmutiIdx].push(deck[cardDealIndex++]);
        } else {
          cardDealIndex++; // 만약을 대비한 무한 루프 방지
        }
      }
    }
    
    game.playerHands = hands; // 더 이상 map, slice 필요 없음. 위에서부터 격리됨.

    // 디버그: 각 플레이어의 카드 수 확인
    console.log('카드 분배 완료:');
    game.ordered.forEach((p, i) => {
      console.log(`${p.nickname} (${p.role}): ${game.playerHands[i].length}장`);
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
    if (game.inProgress) {
      const playerIndex = game.ordered.findIndex(p => p.nickname === nickname);
      if (playerIndex !== -1) {
        console.log(`게임 참가자 ${nickname}가 game.html에 연결했습니다.`);
        
        // 새로운 소켓 ID로 플레이어 정보 업데이트
        game.ordered[playerIndex].id = socket.id;
        const playerInLobbyList = players.find(p => p.nickname === nickname);
        if (playerInLobbyList) playerInLobbyList.id = socket.id;

        // 해당 플레이어에게 게임 데이터 전송
        io.to(socket.id).emit('gameSetup', {
          ordered: game.ordered.map((p, i) => ({ ...p, cardCount: game.playerHands[i].length, finished: game.finished[i] })),
          myCards: game.playerHands[playerIndex],
          turnInfo: { turnIdx: game.turnIdx, currentPlayer: game.ordered[game.turnIdx] },
          field: game.lastPlay
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
    const player = players.find(p => p.id === socket.id);
    if (player && game.inProgress) {
      console.log(`게임 중인 플레이어 ${player.nickname}의 연결이 끊겼습니다.`);
      // 여기서 바로 제거하지 않고, 재접속을 기다리거나 타임아웃 처리
    } else {
      players = players.filter(p => p.id !== socket.id);
      io.emit('players', players);
    }
  });

  // --- 인게임 플레이 로직 ---
  socket.on('playCards', (cards, cb) => {
    const idx = game.ordered.findIndex(p => p.id === socket.id);

    if (!game.inProgress || idx !== game.turnIdx || game.finished[idx]) {
      return cb && cb({success: false, message: '당신의 차례가 아니거나, 게임이 진행중이 아닙니다.'});
    }

    console.log(`\n--- [playCards] Event from ${game.ordered[idx].nickname} (idx: ${idx}) ---`);
    console.log('Cards to play:', cards);
    
    // 유효성 검사 (중복 카드 제출 방지)
    const hand = game.playerHands[idx];
    console.log(`Hand of ${game.ordered[idx].nickname} BEFORE play: ${hand.length} cards -> [${hand.join(',')}]`);
    console.log('All hands BEFORE play:', JSON.stringify(game.playerHands.map(h => h.length)));

    const handCounts = hand.reduce((acc, c) => ({...acc, [c]: (acc[c] || 0) + 1 }), {});
    const playedCounts = cards.reduce((acc, c) => ({...acc, [c]: (acc[c] || 0) + 1 }), {});

    for(const card in playedCounts) {
      if(!handCounts[card] || handCounts[card] < playedCounts[card]) {
        return cb && cb({success: false, message: '손에 없는 카드를 제출했습니다.'});
      }
    }
    
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
    
    if (game.lastPlay) {
      if (cards.length !== game.lastPlay.count) return cb && cb({success: false, message: `이전과 같은 ${game.lastPlay.count}장만 낼 수 있습니다.`});
      if (num >= game.lastPlay.number) return cb && cb({success: false, message: '이전보다 낮은 숫자만 낼 수 있습니다.'});
    }
    
    // 제출 처리
    cards.forEach(c => {
      const cardIndexToRemove = hand.indexOf(c);
      if (cardIndexToRemove > -1) {
        hand.splice(cardIndexToRemove, 1);
      }
    });
    game.lastPlay = {count: cards.length, number: num, playerIdx: idx};
    game.passes = 0;

    console.log(`Hand of ${game.ordered[idx].nickname} AFTER play: ${hand.length} cards`);
    console.log('All hands AFTER play:', JSON.stringify(game.playerHands.map(h => h.length)));
    
    if (hand.length === 0) {
      if (!game.finished[idx]) {
        game.finished[idx] = true;
        game.finishOrder.push(idx);
        console.log(`*** ${game.ordered[idx].nickname} has finished! ***`);
      }
    }

    console.log('`finished` array state:', JSON.stringify(game.finished));
    
    io.emit('playResult', {
      playerIdx: idx, 
      cards, 
      lastPlay: game.lastPlay, 
      finished: game.finished,
      playerHands: game.playerHands.map(hand => hand.length)
    });
    cb && cb({success: true});

    // 게임 종료 체크
    const finishedCount = game.finished.filter(f => f).length;
    console.log(`게임 진행 상황: ${finishedCount}/${players.length} 완주`);
    
    if (finishedCount >= players.length - 1) { // 한 명만 남으면 게임 종료
      // 남은 한 명 자동 꼴찌 처리
      const lastIdx = game.finished.findIndex(f => !f);
      if (lastIdx !== -1) {
        game.finished[lastIdx] = true;
        game.finishOrder.push(lastIdx);
      }
      console.log('모든 플레이어가 완주했습니다! 게임 종료.');
      
      const scores = [10, 8, 6, 5, 4, 3].slice(0, players.length);
      const result = game.finishOrder.map((playerIdx, i) => {
        game.lastGameScores[playerIdx] = scores[i] || 0;
        game.totalScores[playerIdx] = (game.totalScores[playerIdx] || 0) + game.lastGameScores[playerIdx];
        return {
          nickname: game.ordered[playerIdx].nickname,
          role: game.ordered[playerIdx].role,
          score: game.lastGameScores[playerIdx],
          total: game.totalScores[playerIdx]
        }
      });
      
      console.log('게임 종료! 최종 결과:', result);
      io.emit('gameEnd', result);
      
      resetGame();
      return;
    }
    
    // 다음 턴
    do {
      game.turnIdx = (game.turnIdx + 1) % game.ordered.length;
    } while (game.finished[game.turnIdx]);
    
    io.emit('turnChanged', { turnIdx: game.turnIdx, currentPlayer: game.ordered[game.turnIdx] });
  });
  
  socket.on('passTurn', (cb) => {
    const idx = game.ordered.findIndex(p => p.id === socket.id);
    if (!game.inProgress || idx !== game.turnIdx || game.finished[idx]) return;
    
    game.passes++;
    io.emit('passResult', {playerIdx: idx, passes: game.passes});

    console.log(`\n--- [passTurn] Event from ${game.ordered[idx].nickname} (idx: ${idx}) ---`);
    console.log(`Current passes: ${game.passes}`);
    
    // 현재 게임에 참여 중인(완주하지 않은) 플레이어 수 계산
    const activePlayersCount = players.length - game.finished.filter(f => f).length;
    console.log(`Active players: ${activePlayersCount}`);

    // 모두 패스 -> 라운드 리셋
    // 플레이어가 1명만 남은 경우는 패스하지 않고 카드를 내야 함
    if (game.passes >= activePlayersCount-1 && activePlayersCount > 1) {
      console.log('*** All active players have passed. Starting a new round. ***');
      game.passes = 0;
      // 마지막으로 카드를 낸 사람이 턴을 잡음
      if (game.lastPlay) {
        game.turnIdx = game.lastPlay.playerIdx;
        // 마지막으로 카드를 낸 사람이 이미 완료했다면, 다음 완료하지 않은 플레이어에게 턴을 넘김
        if (game.finished[game.turnIdx]) {
          do {
            game.turnIdx = (game.turnIdx + 1) % game.ordered.length;
          } while (game.finished[game.turnIdx]);
        }
      }
      // lastPlay가 null이면 (라운드 첫 턴에 모두 패스하는 비정상적 상황) 현재 턴 유지
      game.lastPlay = null;
      io.emit('newRound', {turnIdx: game.turnIdx, lastPlay: null, currentPlayer: game.ordered[game.turnIdx]});
    } else if (activePlayersCount === 1) {
      // 플레이어가 1명만 남은 경우, 패스할 수 없고 카드를 내야 함
      console.log('*** Only one player remaining. Must play cards. ***');
      // 패스 처리는 하지 않고 턴을 그대로 유지
    } else {
      do {
        game.turnIdx = (game.turnIdx + 1) % game.ordered.length;
      } while (game.finished[game.turnIdx]);
      io.emit('turnChanged', { turnIdx: game.turnIdx, currentPlayer: game.ordered[game.turnIdx] });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
}); 