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
  totalScores: [],
  cardExchangeInProgress: false,
  slaveCardsGiven: [],
  minerCardsGiven: [],
  dalmutiCardSelected: false,
  archbishopCardSelected: false
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
    totalScores: [],
    cardExchangeInProgress: false,
    slaveCardsGiven: [],
    minerCardsGiven: [],
    dalmutiCardSelected: false,
    archbishopCardSelected: false
  };
  players.forEach(p => p.ready = false);
  io.emit('players', players);
}

function startGameIfReady() {
  if (game.inProgress) return;
  
  // 카드 교환 단계가 진행 중이면 게임 시작하지 않음
  if (game.cardExchangeInProgress) {
    console.log('카드 교환 단계가 진행 중이므로 게임 시작을 건너뜁니다.');
    return;
  }

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
    let picked;
    const roles = ['달무티', '대주교', '평민', '평민', '광부', '노예'].slice(0, players.length);
    if (game.gameCount && game.gameCount > 1 && game.lastGameScores.length === players.length) {
      // 두 번째 게임부터는 바로 전 게임 점수 높은 순으로 역할 배정
      picked = players.map((p, i) => ({ id: p.id, nickname: p.nickname, score: game.lastGameScores[i] || 0 }));
      picked.sort((a, b) => b.score - a.score); // 높은 점수 순
      game.ordered = picked.map((p, i) => ({ ...p, role: roles[i] }));
    } else {
      // 첫 게임은 랜덤
      picked = players.map((p, i) => ({ id: p.id, nickname: p.nickname, card: 0 }));
      const numbers = [];
      while (numbers.length < players.length) {
        const n = Math.floor(Math.random() * 12) + 1;
        if (!numbers.includes(n)) numbers.push(n);
      }
      picked.forEach((p,i) => p.card = numbers[i]);
      picked.sort((a, b) => a.card - b.card);
      game.ordered = picked.map((p, i) => ({ ...p, role: roles[i] }));
    }

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

    // 5. 카드 교환 단계 (농노 ↔ 달무티, 광부 ↔ 대주교)
    const slaveIdx = game.ordered.findIndex(p => p.role === '노예');
    const minerIdx = game.ordered.findIndex(p => p.role === '광부');
    const archbishopIdx = game.ordered.findIndex(p => p.role === '대주교');
    
    if (dalmutiIdx !== -1 && slaveIdx !== -1) {
      // 농노의 손패에서 가장 낮은 숫자 2장 찾기 (자동)
      const slaveHand = [...game.playerHands[slaveIdx]];
      slaveHand.sort((a, b) => {
        const aVal = a === 'J' ? 13 : a;
        const bVal = b === 'J' ? 13 : b;
        return aVal - bVal;
      });
      const lowestCards = slaveHand.slice(0, 2);
      
      // 농노의 카드를 달무티에게 전달
      lowestCards.forEach(card => {
        const cardIndex = game.playerHands[slaveIdx].indexOf(card);
        if (cardIndex > -1) {
          game.playerHands[slaveIdx].splice(cardIndex, 1);
          game.playerHands[dalmutiIdx].push(card);
        }
      });
      
      console.log(`농노(${game.ordered[slaveIdx].nickname})가 달무티에게 카드 전달: [${lowestCards.join(',')}]`);
      
      // 카드 교환 완료 플래그 설정
      game.cardExchangeInProgress = true;
      game.slaveCardsGiven = lowestCards;
    }
    
    if (minerIdx !== -1 && archbishopIdx !== -1) {
      // 광부의 손패에서 가장 낮은 숫자 1장 찾기 (자동)
      const minerHand = [...game.playerHands[minerIdx]];
      minerHand.sort((a, b) => {
        const aVal = a === 'J' ? 13 : a;
        const bVal = b === 'J' ? 13 : b;
        return aVal - bVal;
      });
      const lowestCard = minerHand[0];
      
      // 광부의 카드를 대주교에게 전달
      const cardIndex = game.playerHands[minerIdx].indexOf(lowestCard);
      if (cardIndex > -1) {
        game.playerHands[minerIdx].splice(cardIndex, 1);
        game.playerHands[archbishopIdx].push(lowestCard);
      }
      
      console.log(`광부(${game.ordered[minerIdx].nickname})가 대주교에게 카드 전달: [${lowestCard}]`);
      
      // 카드 교환 완료 플래그 설정
      game.cardExchangeInProgress = true;
      game.minerCardsGiven = [lowestCard];
    }
    
    if (game.cardExchangeInProgress) {
      console.log('=== 카드 교환 단계 시작 설정 ===');
      console.log(`cardExchangeInProgress: ${game.cardExchangeInProgress}`);
      if (game.slaveCardsGiven.length > 0) {
        console.log(`slaveCardsGiven: [${game.slaveCardsGiven.join(',')}]`);
      }
      if (game.minerCardsGiven.length > 0) {
        console.log(`minerCardsGiven: [${game.minerCardsGiven.join(',')}]`);
      }
      
      // 카드 선택 완료 상태 초기화
      game.dalmutiCardSelected = false;
      game.archbishopCardSelected = false;
      
      // 먼저 클라이언트들에게 게임 페이지로 이동하라고 알림
      io.emit('gameStart');
      console.log('gameStart 이벤트 전송. 클라이언트들이 game.html로 이동합니다.');
      
      // 3초 후에 카드 선택 요청 (클라이언트들이 game.html로 이동할 시간을 줌)
      setTimeout(() => {
        console.log('=== 카드 교환 단계 시작 ===');
        
        // 달무티 카드 선택 요청
        if (dalmutiIdx !== -1 && slaveIdx !== -1) {
          console.log(`달무티 ID: ${game.ordered[dalmutiIdx].id}`);
          console.log(`달무티 닉네임: ${game.ordered[dalmutiIdx].nickname}`);
          console.log(`달무티 손패: [${game.playerHands[dalmutiIdx].join(',')}]`);
          
          // 달무티에게 카드 선택 요청
          io.to(game.ordered[dalmutiIdx].id).emit('selectCardsForSlave', {
            message: '농노에게 줄 카드 2장을 선택하세요.',
            hand: game.playerHands[dalmutiIdx]
          });
          console.log(`달무티(${game.ordered[dalmutiIdx].nickname})에게 selectCardsForSlave 이벤트 전송 완료`);
          console.log(`달무티 소켓 ID: ${game.ordered[dalmutiIdx].id}`);
          console.log(`달무티 손패 개수: ${game.playerHands[dalmutiIdx].length}장`);
          
          // 달무티가 실제로 연결되어 있는지 확인
          const dalmutiSocket = io.sockets.sockets.get(game.ordered[dalmutiIdx].id);
          if (dalmutiSocket) {
            console.log('달무티 소켓이 연결되어 있습니다.');
          } else {
            console.log('⚠️ 경고: 달무티 소켓이 연결되어 있지 않습니다!');
          }
        }
        
        // 대주교 카드 선택 요청
        if (archbishopIdx !== -1 && minerIdx !== -1) {
          console.log(`대주교 ID: ${game.ordered[archbishopIdx].id}`);
          console.log(`대주교 닉네임: ${game.ordered[archbishopIdx].nickname}`);
          console.log(`대주교 손패: [${game.playerHands[archbishopIdx].join(',')}]`);
          
          // 대주교에게 카드 선택 요청
          io.to(game.ordered[archbishopIdx].id).emit('selectCardsForMiner', {
            message: '광부에게 줄 카드 1장을 선택하세요.',
            hand: game.playerHands[archbishopIdx]
          });
          console.log(`대주교(${game.ordered[archbishopIdx].nickname})에게 selectCardsForMiner 이벤트 전송 완료`);
          console.log(`대주교 소켓 ID: ${game.ordered[archbishopIdx].id}`);
          console.log(`대주교 손패 개수: ${game.playerHands[archbishopIdx].length}장`);
          
          // 대주교가 실제로 연결되어 있는지 확인
          const archbishopSocket = io.sockets.sockets.get(game.ordered[archbishopIdx].id);
          if (archbishopSocket) {
            console.log('대주교 소켓이 연결되어 있습니다.');
          } else {
            console.log('⚠️ 경고: 대주교 소켓이 연결되어 있지 않습니다!');
          }
        }
        
        // 다른 플레이어들에게 대기 메시지
        game.ordered.forEach((p, i) => {
          if (i !== dalmutiIdx && i !== archbishopIdx) {
            let waitingMessage = '';
            if (dalmutiIdx !== -1 && archbishopIdx !== -1) {
              waitingMessage = `${game.ordered[dalmutiIdx].nickname}님과 ${game.ordered[archbishopIdx].nickname}님이 카드 교환을 진행하고 있습니다...`;
            } else if (dalmutiIdx !== -1) {
              waitingMessage = `${game.ordered[dalmutiIdx].nickname}님이 농노에게 줄 카드를 선택하고 있습니다...`;
            } else if (archbishopIdx !== -1) {
              waitingMessage = `${game.ordered[archbishopIdx].nickname}님이 광부에게 줄 카드를 선택하고 있습니다...`;
            }
            
            io.to(p.id).emit('waitingForCardExchange', {
              message: waitingMessage
            });
            console.log(`${p.nickname}에게 waitingForCardExchange 이벤트 전송 완료`);
          }
        });
        
        console.log('카드 교환 단계 시작...');
      }, 3000);
    } else {
      // 카드 교환이 필요한 역할이 없는 경우 바로 게임 시작
      startGameAfterCardExchange();
    }

    // 카드 교환이 완료되면 게임이 시작됩니다 (dalmutiCardSelection 이벤트에서 처리)
    console.log('카드 교환 단계 시작...');
  }
}

// 카드 교환 완료 후 게임 시작 함수
function startGameAfterCardExchange() {
  console.log('=== startGameAfterCardExchange 함수 호출 ===');
  console.log('카드 교환 완료! 게임을 시작합니다.');
  console.log(`게임 진행 중: ${game.inProgress}`);
  console.log(`카드 교환 진행 중: ${game.cardExchangeInProgress}`);
  
  // 카드 교환 완료 플래그 및 상태 초기화
  game.cardExchangeInProgress = false;
  game.slaveCardsGiven = [];
  game.minerCardsGiven = [];
  game.dalmutiCardSelected = false;
  game.archbishopCardSelected = false;
  
  // 바로 게임 세팅 데이터 전송
  game.ordered.forEach((p, i) => {
    console.log(`${p.nickname}에게 gameSetup 전송 - 카드 ${game.playerHands[i].length}장`);
    io.to(p.id).emit('gameSetup', {
      ordered: game.ordered.map((p, i) => ({ ...p, cardCount: game.playerHands[i].length, finished: game.finished[i] })),
      myCards: game.playerHands[i],
      turnInfo: { turnIdx: game.turnIdx, currentPlayer: game.ordered[game.turnIdx] },
      field: game.lastPlay
    });
  });
  console.log('gameSetup 데이터 전송 완료.');
}

io.on('connection', (socket) => {
  socket.on('join', (nickname, callback) => {
    socket.nickname = nickname;

    // --- 게임 재접속 및 데이터 전송 로직 ---
    if (game.inProgress) {
      const playerIndex = game.ordered.findIndex(p => p.nickname === nickname);
      if (playerIndex !== -1) {
        console.log(`게임 참가자 ${nickname}가 game.html에 연결했습니다.`);
        console.log(`이전 소켓 ID: ${game.ordered[playerIndex].id}`);
        console.log(`새로운 소켓 ID: ${socket.id}`);
        
        // 새로운 소켓 ID로 플레이어 정보 업데이트
        game.ordered[playerIndex].id = socket.id;
        const playerInLobbyList = players.find(p => p.nickname === nickname);
        if (playerInLobbyList) playerInLobbyList.id = socket.id;

        console.log(`소켓 ID 업데이트 완료: ${nickname} -> ${socket.id}`);
        
        // --- 재접속 시 상태에 따른 분기 처리 ---
        if (game.cardExchangeInProgress) {
          const dalmutiIdx = game.ordered.findIndex(p => p.role === '달무티');
          const archbishopIdx = game.ordered.findIndex(p => p.role === '대주교');
          const dalmuti = game.ordered[dalmutiIdx];
          const archbishop = game.ordered[archbishopIdx];

          if (playerIndex === dalmutiIdx) {
            // 재접속한 플레이어가 '달무티'인 경우
            console.log(`달무티 ${nickname} 재접속 - 카드 선택 요청을 다시 보냅니다.`);
            setTimeout(() => { // 클라이언트가 준비될 시간을 줍니다.
              io.to(socket.id).emit('selectCardsForSlave', {
                message: '농노에게 줄 카드 2장을 선택하세요.',
                hand: game.playerHands[playerIndex]
              });
            }, 500);
          } else if (playerIndex === archbishopIdx) {
            // 재접속한 플레이어가 '대주교'인 경우
            console.log(`대주교 ${nickname} 재접속 - 카드 선택 요청을 다시 보냅니다.`);
            setTimeout(() => { // 클라이언트가 준비될 시간을 줍니다.
              io.to(socket.id).emit('selectCardsForMiner', {
                message: '광부에게 줄 카드 1장을 선택하세요.',
                hand: game.playerHands[playerIndex]
              });
            }, 500);
          } else {
            // 재접속한 플레이어가 다른 플레이어인 경우
            console.log(`${nickname} 재접속 - 대기 화면을 표시합니다.`);
            let waitingMessage = '';
            if (dalmutiIdx !== -1 && archbishopIdx !== -1) {
              waitingMessage = `${dalmuti.nickname}님과 ${archbishop.nickname}님이 카드 교환을 진행하고 있습니다...`;
            } else if (dalmutiIdx !== -1) {
              waitingMessage = `${dalmuti.nickname}님이 농노에게 줄 카드를 선택하고 있습니다...`;
            } else if (archbishopIdx !== -1) {
              waitingMessage = `${archbishop.nickname}님이 광부에게 줄 카드를 선택하고 있습니다...`;
            }
            
            io.to(socket.id).emit('waitingForCardExchange', {
              message: waitingMessage
            });
          }
        } else {
          // 카드 교환 단계가 아닐 때만 gameSetup 전송
          io.to(socket.id).emit('gameSetup', {
            ordered: game.ordered.map((p, i) => ({ ...p, cardCount: game.playerHands[i].length, finished: game.finished[i] })),
            myCards: game.playerHands[playerIndex],
            turnInfo: { turnIdx: game.turnIdx, currentPlayer: game.ordered[game.turnIdx] },
            field: game.lastPlay
          });
        }
        
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
    
    console.log('=== ready 이벤트 처리 ===');
    console.log(`플레이어: ${player ? player.nickname : 'unknown'}`);
    console.log(`카드 교환 진행 중: ${game.cardExchangeInProgress}`);
    console.log(`게임 진행 중: ${game.inProgress}`);
    
    // 카드 교환 단계가 진행 중이면 게임 시작하지 않음
    if (!game.cardExchangeInProgress) {
      console.log('카드 교환 진행 중이 아니므로 startGameIfReady 호출');
      startGameIfReady();
    } else {
      console.log('카드 교환 단계가 진행 중이므로 ready 이벤트에서 게임 시작을 건너뜁니다.');
    }
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
      
      // 5초 후 자동으로 다음 게임 시작
      setTimeout(() => {
        // 게임 상태만 리셋 (점수, totalScores 등은 유지)
        game.inProgress = false;
        game.ordered = [];
        game.turnIdx = 0;
        game.lastPlay = null;
        game.passes = 0;
        game.playerHands = [];
        game.finished = [];
        game.finishOrder = [];
        game.gameCount = (game.gameCount || 1) + 1; // 게임 횟수 증가
        // lastGameScores, totalScores는 유지

        startGameIfReady();
      }, 5000);
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

  // 달무티가 농노에게 줄 카드 선택
  socket.on('dalmutiCardSelection', (selectedCards, cb) => {
    console.log('=== dalmutiCardSelection 이벤트 수신 ===');
    console.log(`요청한 소켓 ID: ${socket.id}`);
    console.log(`선택된 카드: [${selectedCards.join(',')}]`);
    
    const idx = game.ordered.findIndex(p => p.id === socket.id);
    const dalmutiIdx = game.ordered.findIndex(p => p.role === '달무티');
    
    console.log(`요청한 플레이어 인덱스: ${idx}`);
    console.log(`달무티 인덱스: ${dalmutiIdx}`);
    console.log(`카드 교환 진행 중: ${game.cardExchangeInProgress}`);
    
    if (!game.cardExchangeInProgress || idx !== dalmutiIdx) {
      console.log('카드 교환 조건 불충족 - 이벤트 무시');
      return cb && cb({success: false, message: '카드 교환 단계가 아니거나 달무티가 아닙니다.'});
    }
    
    if (selectedCards.length !== 2) {
      console.log('카드 개수 오류 - 이벤트 무시');
      return cb && cb({success: false, message: '정확히 2장의 카드를 선택해주세요.'});
    }
    
    // 선택된 카드가 손패에 있는지 확인
    const hand = [...game.playerHands[idx]];
    console.log(`달무티 손패: [${hand.join(',')}]`);
    
    for (const card of selectedCards) {
      const cardIndex = hand.indexOf(card);
      if (cardIndex === -1) {
        console.log(`손패에 없는 카드 선택: ${card}`);
        return cb && cb({success: false, message: '손패에 없는 카드를 선택했습니다.'});
      }
      hand.splice(cardIndex, 1); // 중복 선택 방지를 위해 임시로 제거
    }
    
    // 농노에게 카드 전달
    const slaveIdx = game.ordered.findIndex(p => p.role === '노예');
    console.log(`농노 인덱스: ${slaveIdx}`);
    
    selectedCards.forEach(card => {
      const cardIndex = game.playerHands[idx].indexOf(card);
      if (cardIndex > -1) {
        game.playerHands[idx].splice(cardIndex, 1);
        game.playerHands[slaveIdx].push(card);
      }
    });
    
    console.log(`달무티(${game.ordered[idx].nickname})가 농노에게 카드 전달: [${selectedCards.join(',')}]`);
    console.log(`달무티 최종 손패: [${game.playerHands[idx].join(',')}]`);
    console.log(`농노 최종 손패: [${game.playerHands[slaveIdx].join(',')}]`);
    
    // 카드 교환 완료 알림
    io.emit('cardExchange', {
      slave: { nickname: game.ordered[slaveIdx].nickname, cards: game.slaveCardsGiven },
      dalmuti: { nickname: game.ordered[idx].nickname, cards: selectedCards }
    });
    
    // 달무티 카드 선택 완료 상태 업데이트
    game.dalmutiCardSelected = true;
    
    // 게임 시작 준비 완료
    cb && cb({success: true});
    
    // 대주교도 카드 선택을 완료했는지 확인
    const archbishopIdx = game.ordered.findIndex(p => p.role === '대주교');
    if (archbishopIdx === -1 || game.archbishopCardSelected) {
      // 대주교가 없거나 이미 카드 선택을 완료한 경우 게임 시작
      console.log('달무티 카드 선택 완료! 게임 시작 함수 호출');
      startGameAfterCardExchange();
    } else {
      console.log('달무티 카드 선택 완료! 대주교 카드 선택 대기 중...');
    }
  });

  // 대주교가 광부에게 줄 카드 선택
  socket.on('archbishopCardSelection', (selectedCards, cb) => {
    console.log('=== archbishopCardSelection 이벤트 수신 ===');
    console.log(`요청한 소켓 ID: ${socket.id}`);
    console.log(`선택된 카드: [${selectedCards.join(',')}]`);
    
    const idx = game.ordered.findIndex(p => p.id === socket.id);
    const archbishopIdx = game.ordered.findIndex(p => p.role === '대주교');
    
    console.log(`요청한 플레이어 인덱스: ${idx}`);
    console.log(`대주교 인덱스: ${archbishopIdx}`);
    console.log(`카드 교환 진행 중: ${game.cardExchangeInProgress}`);
    
    if (!game.cardExchangeInProgress || idx !== archbishopIdx) {
      console.log('카드 교환 조건 불충족 - 이벤트 무시');
      return cb && cb({success: false, message: '카드 교환 단계가 아니거나 대주교가 아닙니다.'});
    }
    
    if (selectedCards.length !== 1) {
      console.log('카드 개수 오류 - 이벤트 무시');
      return cb && cb({success: false, message: '정확히 1장의 카드를 선택해주세요.'});
    }
    
    // 선택된 카드가 손패에 있는지 확인
    const hand = [...game.playerHands[idx]];
    console.log(`대주교 손패: [${hand.join(',')}]`);
    
    for (const card of selectedCards) {
      const cardIndex = hand.indexOf(card);
      if (cardIndex === -1) {
        console.log(`손패에 없는 카드 선택: ${card}`);
        return cb && cb({success: false, message: '손패에 없는 카드를 선택했습니다.'});
      }
      hand.splice(cardIndex, 1); // 중복 선택 방지를 위해 임시로 제거
    }
    
    // 광부에게 카드 전달
    const minerIdx = game.ordered.findIndex(p => p.role === '광부');
    console.log(`광부 인덱스: ${minerIdx}`);
    
    selectedCards.forEach(card => {
      const cardIndex = game.playerHands[idx].indexOf(card);
      if (cardIndex > -1) {
        game.playerHands[idx].splice(cardIndex, 1);
        game.playerHands[minerIdx].push(card);
      }
    });
    
    console.log(`대주교(${game.ordered[idx].nickname})가 광부에게 카드 전달: [${selectedCards.join(',')}]`);
    console.log(`대주교 최종 손패: [${game.playerHands[idx].join(',')}]`);
    console.log(`광부 최종 손패: [${game.playerHands[minerIdx].join(',')}]`);
    
    // 카드 교환 완료 알림 (대주교-광부)
    io.emit('cardExchange', {
      miner: { nickname: game.ordered[minerIdx].nickname, cards: game.minerCardsGiven },
      archbishop: { nickname: game.ordered[idx].nickname, cards: selectedCards }
    });
    
    // 대주교 카드 선택 완료 상태 업데이트
    game.archbishopCardSelected = true;
    
    // 게임 시작 준비 완료
    cb && cb({success: true});
    
    // 달무티도 카드 선택을 완료했는지 확인
    const dalmutiIdx = game.ordered.findIndex(p => p.role === '달무티');
    if (dalmutiIdx === -1 || game.dalmutiCardSelected) {
      // 달무티가 없거나 이미 카드 선택을 완료한 경우 게임 시작
      console.log('대주교 카드 선택 완료! 게임 시작 함수 호출');
      startGameAfterCardExchange();
    } else {
      console.log('대주교 카드 선택 완료! 달무티 카드 선택 대기 중...');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
}); 