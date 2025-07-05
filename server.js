const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
app.use(express.json()); // JSON body parser for API endpoints
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // 모든 출처에서의 연결을 허용합니다.
    methods: ["GET", "POST"]
  }
});

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 8;

// --- 방 관리 구조 추가 ---
const rooms = {};

function createRoom(roomId, roomName, maxPlayers) {
  rooms[roomId] = {
    id: roomId,
    name: roomName,
    players: [],
    game: null, // 기존 game 구조를 여기에 넣음
    createdAt: Date.now(),
    timerEnabled: true, // 타이머 ON이 기본값
    maxPlayers: maxPlayers || MAX_PLAYERS
  };
}

function deleteRoom(roomId) {
  delete rooms[roomId];
}


app.use(express.static(__dirname));

// 방 생성 API (console.log 추가)
app.post('/api/create-room', (req, res) => {
  const { roomName, maxPlayers } = req.body;
  if (!roomName || typeof roomName !== 'string' || !roomName.trim()) {
    return res.json({ success: false, message: '방 이름을 입력하세요.' });
  }
  let maxP = parseInt(maxPlayers, 10);
  if (isNaN(maxP) || maxP < MIN_PLAYERS || maxP > MAX_PLAYERS) maxP = MAX_PLAYERS;
  // 고유 roomId 생성 (예: timestamp+랜덤)
  const roomId = 'room_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  if (rooms[roomId]) {
    return res.json({ success: false, message: '방 ID 중복. 다시 시도하세요.' });
  }
  createRoom(roomId, roomName.trim(), maxP);
  console.log('방 생성:', roomId, roomName, '최대인원:', maxP); // 생성 로그
  res.json({ success: true, roomId });
});

// 방 목록 API
app.get('/api/rooms', (req, res) => {
  res.json(Object.values(rooms).map(r => ({
    id: r.id,
    name: r.name,
    playerCount: r.players.length,
    maxPlayers: r.maxPlayers || MAX_PLAYERS
  })));
});

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
// catch-all: GET만 /join.html로, 그 외는 404
app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.redirect('/join.html');
  } else {
    res.status(404).send('Not found');
  }
});

function resetGame(roomId) {
  // 게임 상태를 완전히 초기화
  rooms[roomId].game = {
    inProgress: false,
    ordered: [],
    turnIdx: 0,
    lastPlay: null,
    passes: 0,
    playerHands: [],
    finished: [],
    finishOrder: [],
    gameCount: 1,
    lastGameScores: {}, // { nickname: score }
    totalScores: {},    // { nickname: totalScore }
    cardExchangeInProgress: false,
    slaveCardsGiven: [],
    minerCardsGiven: [],
    dalmutiCardSelected: false,
    archbishopCardSelected: false,
    isFirstTurnOfRound: false // 새로운 라운드의 첫 턴인지 추적
  };
  
  // 게임이 중단되었음을 클라이언트에게 알림
  io.to(roomId).emit('gameInterrupted', { message: '게임 진행 중에 플레이어가 나가서 게임이 중단되었습니다.' });
  
  // players 배열은 그대로 유지 (남은 플레이어들이 게임 나가기 버튼을 사용할 수 있도록)
  // 대신 플레이어 목록 업데이트는 하지 않음
}

function startGameIfReady(roomId) {
  if (rooms[roomId].game.inProgress) return;
  
  // 카드 교환 단계가 진행 중이면 게임 시작하지 않음
  if (rooms[roomId].game.cardExchangeInProgress) {
    console.log('카드 교환 단계가 진행 중이므로 게임 시작을 건너뜁니다.');
    return;
  }

  if (rooms[roomId].players.length >= MIN_PLAYERS && rooms[roomId].players.length <= MAX_PLAYERS && rooms[roomId].players.every(p => p.ready)) {
    console.log('게임 시작 조건 충족! 데이터 준비 중...');
    rooms[roomId].game.inProgress = true;
    
    // 1. 숫자 뽑기
    const numbers = [];
    while (numbers.length < rooms[roomId].players.length) {
      const n = Math.floor(Math.random() * 12) + 1;
      if (!numbers.includes(n)) numbers.push(n);
    }
    
    // 2. 신분 및 순서 배정
    let picked;
    // 인원에 따른 신분 배정
    let roles;
    if (rooms[roomId].players.length === 4) {
      roles = ['달무티', '대주교', '광부', '노예'];
    } else if (rooms[roomId].players.length === 5) {
      roles = ['달무티', '대주교', '평민', '광부', '노예'];
    } else if (rooms[roomId].players.length === 6) {
      roles = ['달무티', '대주교', '평민', '평민', '광부', '노예'];
    } else if (rooms[roomId].players.length === 7) {
      roles = ['달무티', '대주교', '평민', '평민', '평민', '광부', '노예'];
    } else if (rooms[roomId].players.length === 8) {
      roles = ['달무티', '대주교', '평민', '평민', '평민', '평민', '광부', '노예'];
    }
    // 디버깅: players와 lastGameScores 매칭 상태 출력
    console.log('players:', rooms[roomId].players.map((p, i) => `${i}: ${p.nickname}`));
    console.log('lastGameScores:', rooms[roomId].game.lastGameScores);
    if (rooms[roomId].game.gameCount && rooms[roomId].game.gameCount > 1 && Object.keys(rooms[roomId].game.lastGameScores).length === rooms[roomId].players.length) {
      // 두 번째 게임부터는 바로 전 게임 점수 높은 순으로 역할 배정
      picked = rooms[roomId].players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        score: rooms[roomId].game.lastGameScores[p.nickname] || 0
      }));
      picked.sort((a, b) => b.score - a.score);
      // 디버깅: picked와 roles 매칭 상태 출력
      console.log('picked:', picked.map(p => `${p.nickname}:${p.score}`));
      console.log('roles:', roles);
      console.log('배정:', picked.map((p, i) => `${p.nickname} => ${roles[i]}`));
      rooms[roomId].game.ordered = picked.map((p, i) => ({ ...p, role: roles[i] }));
    } else {
      // 첫 게임은 랜덤
      picked = rooms[roomId].players.map((p, i) => ({ id: p.id, nickname: p.nickname, card: 0 }));
      const numbers = [];
      while (numbers.length < rooms[roomId].players.length) {
        const n = Math.floor(Math.random() * 12) + 1;
        if (!numbers.includes(n)) numbers.push(n);
      }
      picked.forEach((p,i) => p.card = numbers[i]);
      picked.sort((a, b) => a.card - b.card);
      rooms[roomId].game.ordered = picked.map((p, i) => ({ ...p, role: roles[i] }));
    }

    // 3. 게임 상태 초기화
    rooms[roomId].game.turnIdx = 0;
    rooms[roomId].game.lastPlay = null;
    rooms[roomId].game.passes = 0;
    rooms[roomId].game.finished = Array(rooms[roomId].game.ordered.length).fill(false);
    rooms[roomId].game.finishOrder = [];
    rooms[roomId].game.isFirstTurnOfRound = true; // 게임 시작 시 첫 턴 플래그 설정
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
    
    const hands = Array(rooms[roomId].game.ordered.length).fill(null).map(() => []);
    let cardDealIndex = 0;
    
    // 인원에 따른 카드 배분
    let baseCards, dalmutiExtraCards;
    if (rooms[roomId].players.length === 4) {
      baseCards = 20;
      dalmutiExtraCards = 0;
    } else if (rooms[roomId].players.length === 5) {
      baseCards = 16;
      dalmutiExtraCards = 0;
    } else if (rooms[roomId].players.length === 6) {
      baseCards = 13;
      dalmutiExtraCards = 2; // 달무티만 15장
    } else if (rooms[roomId].players.length === 7) {
      baseCards = 11;
      dalmutiExtraCards = 3; // 달무티만 14장
    } else if (rooms[roomId].players.length === 8) {
      baseCards = 10;
      dalmutiExtraCards = 0;
    }
    
    // 기본 카드 분배 (라운드-로빈 방식)
    for (let i = 0; i < baseCards; i++) {
      for (let j = 0; j < rooms[roomId].game.ordered.length; j++) {
        if(deck[cardDealIndex]) {
          hands[j].push(deck[cardDealIndex++]);
        }
      }
    }

    // 달무티에게 추가 카드 분배
    const dalmutiIdx = rooms[roomId].game.ordered.findIndex(p => p.role === '달무티');
    if (dalmutiIdx !== -1 && dalmutiExtraCards > 0) {
      for (let i = 0; i < dalmutiExtraCards; i++) {
        if(deck[cardDealIndex]) {
          hands[dalmutiIdx].push(deck[cardDealIndex++]);
        }
      }
    }
    
    // 각 손패를 정렬
    hands.forEach(hand => hand.sort((a, b) => (a === 'J' ? 13 : a) - (b === 'J' ? 13 : b)));
    rooms[roomId].game.playerHands = hands; // 더 이상 map, slice 필요 없음. 위에서부터 격리됨.

    // 5. 혁명 기회 체크
    const joker2Idx = hands.findIndex(hand => hand.filter(c => c === 'J').length === 2);
    if (joker2Idx !== -1) {
      // 먼저 클라이언트들에게 게임 페이지로 이동하라고 알림
      io.to(roomId).emit('gameStart');
      console.log('혁명 기회! gameStart 이벤트 전송. 클라이언트들이 game.html로 이동합니다.');
      
      // 5초 후에 혁명 선택 요청 (클라이언트들이 game.html로 이동할 시간을 더 줌)
      setTimeout(() => {
        // 혁명 선택 기회 부여
        const revPlayer = rooms[roomId].game.ordered[joker2Idx];
        io.to(revPlayer.id).emit('revolutionChoice', {
          role: revPlayer.role,
          nickname: revPlayer.nickname
        });
        // 나머지 플레이어들은 대기 메시지
        rooms[roomId].game.ordered.forEach((p, i) => {
          if (i !== joker2Idx) {
            io.to(p.id).emit('waitingForCardExchange', { message: `${revPlayer.nickname}님이 혁명 선언 여부를 선택 중입니다...` });
          }
        });
      }, 5000);
      // 혁명 선택 결과를 기다림 (아래에 revolutionResult 핸들러 추가 필요)
      return;
    }
    // 혁명 기회가 없으면 기존 카드 교환 단계로 진행
    // 5. 카드 교환 단계 (농노 ↔ 달무티, 광부 ↔ 대주교)
    const slaveIdx = rooms[roomId].game.ordered.findIndex(p => p.role === '노예');
    const minerIdx = rooms[roomId].game.ordered.findIndex(p => p.role === '광부');
    const archbishopIdx = rooms[roomId].game.ordered.findIndex(p => p.role === '대주교');
    
    if (dalmutiIdx !== -1 && slaveIdx !== -1) {
      // 농노의 손패에서 가장 낮은 숫자 2장 찾기 (자동)
      const slaveHand = [...rooms[roomId].game.playerHands[slaveIdx]];
      slaveHand.sort((a, b) => {
        const aVal = a === 'J' ? 13 : a;
        const bVal = b === 'J' ? 13 : b;
        return aVal - bVal;
      });
      const lowestCards = slaveHand.slice(0, 2);
      
      // 농노의 카드를 달무티에게 전달
      lowestCards.forEach(card => {
        const cardIndex = rooms[roomId].game.playerHands[slaveIdx].indexOf(card);
        if (cardIndex > -1) {
          rooms[roomId].game.playerHands[slaveIdx].splice(cardIndex, 1);
          rooms[roomId].game.playerHands[dalmutiIdx].push(card);
        }
      });
      // 카드 교환 후 손패 정렬
      rooms[roomId].game.playerHands.forEach(hand => hand.sort((a, b) => (a === 'J' ? 13 : a) - (b === 'J' ? 13 : b)));
      console.log(`농노(${rooms[roomId].game.ordered[slaveIdx].nickname})가 달무티에게 카드 전달: [${lowestCards.join(',')}]`);
      // 카드 교환 완료 플래그 설정
      rooms[roomId].game.cardExchangeInProgress = true;
      rooms[roomId].game.slaveCardsGiven = lowestCards;
    }
    
    if (minerIdx !== -1 && archbishopIdx !== -1) {
      // 광부의 손패에서 가장 낮은 숫자 1장 찾기 (자동)
      const minerHand = [...rooms[roomId].game.playerHands[minerIdx]];
      minerHand.sort((a, b) => {
        const aVal = a === 'J' ? 13 : a;
        const bVal = b === 'J' ? 13 : b;
        return aVal - bVal;
      });
      const lowestCard = minerHand[0];
      
      // 광부의 카드를 대주교에게 전달
      const cardIndex = rooms[roomId].game.playerHands[minerIdx].indexOf(lowestCard);
      if (cardIndex > -1) {
        rooms[roomId].game.playerHands[minerIdx].splice(cardIndex, 1);
        rooms[roomId].game.playerHands[archbishopIdx].push(lowestCard);
      }
      // 카드 교환 후 손패 정렬
      rooms[roomId].game.playerHands.forEach(hand => hand.sort((a, b) => (a === 'J' ? 13 : a) - (b === 'J' ? 13 : b)));
      console.log(`광부(${rooms[roomId].game.ordered[minerIdx].nickname})가 대주교에게 카드 전달: [${lowestCard}]`);
      // 카드 교환 완료 플래그 설정
      rooms[roomId].game.cardExchangeInProgress = true;
      rooms[roomId].game.minerCardsGiven = [lowestCard];
    }
    
    if (rooms[roomId].game.cardExchangeInProgress) {
      console.log('=== 카드 교환 단계 시작 설정 ===');
      console.log(`cardExchangeInProgress: ${rooms[roomId].game.cardExchangeInProgress}`);
      if (rooms[roomId].game.slaveCardsGiven.length > 0) {
        console.log(`slaveCardsGiven: [${rooms[roomId].game.slaveCardsGiven.join(',')}]`);
      }
      if (rooms[roomId].game.minerCardsGiven.length > 0) {
        console.log(`minerCardsGiven: [${rooms[roomId].game.minerCardsGiven.join(',')}]`);
      }
      
      // 카드 선택 완료 상태 초기화
      rooms[roomId].game.dalmutiCardSelected = false;
      rooms[roomId].game.archbishopCardSelected = false;
      
      // 먼저 클라이언트들에게 게임 페이지로 이동하라고 알림
      io.to(roomId).emit('gameStart');
      console.log('gameStart 이벤트 전송. 클라이언트들이 game.html로 이동합니다.');
      
      // 3초 후에 카드 선택 요청 (클라이언트들이 game.html로 이동할 시간을 줌)
      setTimeout(() => {
        console.log('=== 카드 교환 단계 시작 ===');
        
        // 달무티 카드 선택 요청
        if (dalmutiIdx !== -1 && slaveIdx !== -1) {
          console.log(`달무티 ID: ${rooms[roomId].game.ordered[dalmutiIdx].id}`);
          console.log(`달무티 닉네임: ${rooms[roomId].game.ordered[dalmutiIdx].nickname}`);
          console.log(`달무티 손패: [${rooms[roomId].game.playerHands[dalmutiIdx].join(',')}]`);
          
          // 달무티에게 카드 선택 요청
          io.to(rooms[roomId].game.ordered[dalmutiIdx].id).emit('selectCardsForSlave', {
            message: '농노에게 줄 카드 2장을 선택하세요.',
            hand: rooms[roomId].game.playerHands[dalmutiIdx]
          });
          console.log(`달무티(${rooms[roomId].game.ordered[dalmutiIdx].nickname})에게 selectCardsForSlave 이벤트 전송 완료`);
          console.log(`달무티 소켓 ID: ${rooms[roomId].game.ordered[dalmutiIdx].id}`);
          console.log(`달무티 손패 개수: ${rooms[roomId].game.playerHands[dalmutiIdx].length}장`);
          
          // 달무티가 실제로 연결되어 있는지 확인
          const dalmutiSocket = io.sockets.sockets.get(rooms[roomId].game.ordered[dalmutiIdx].id);
          if (dalmutiSocket) {
            console.log('달무티 소켓이 연결되어 있습니다.');
          } else {
            console.log('⚠️ 경고: 달무티 소켓이 연결되어 있지 않습니다!');
          }
        }
        
        // 대주교 카드 선택 요청
        if (archbishopIdx !== -1 && minerIdx !== -1) {
          console.log(`대주교 ID: ${rooms[roomId].game.ordered[archbishopIdx].id}`);
          console.log(`대주교 닉네임: ${rooms[roomId].game.ordered[archbishopIdx].nickname}`);
          console.log(`대주교 손패: [${rooms[roomId].game.playerHands[archbishopIdx].join(',')}]`);
          
          // 대주교에게 카드 선택 요청
          io.to(rooms[roomId].game.ordered[archbishopIdx].id).emit('selectCardsForMiner', {
            message: '광부에게 줄 카드 1장을 선택하세요.',
            hand: rooms[roomId].game.playerHands[archbishopIdx]
          });
          console.log(`대주교(${rooms[roomId].game.ordered[archbishopIdx].nickname})에게 selectCardsForMiner 이벤트 전송 완료`);
          console.log(`대주교 소켓 ID: ${rooms[roomId].game.ordered[archbishopIdx].id}`);
          console.log(`대주교 손패 개수: ${rooms[roomId].game.playerHands[archbishopIdx].length}장`);
          
          // 대주교가 실제로 연결되어 있는지 확인
          const archbishopSocket = io.sockets.sockets.get(rooms[roomId].game.ordered[archbishopIdx].id);
          if (archbishopSocket) {
            console.log('대주교 소켓이 연결되어 있습니다.');
          } else {
            console.log('⚠️ 경고: 대주교 소켓이 연결되어 있지 않습니다!');
          }
        }
        
        // 다른 플레이어들에게 대기 메시지
        rooms[roomId].game.ordered.forEach((p, i) => {
          if (i !== dalmutiIdx && i !== archbishopIdx) {
            let waitingMessage = '';
            if (dalmutiIdx !== -1 && archbishopIdx !== -1) {
              waitingMessage = `${rooms[roomId].game.ordered[dalmutiIdx].nickname}님과 ${rooms[roomId].game.ordered[archbishopIdx].nickname}님이 카드 교환을 진행하고 있습니다...`;
            } else if (dalmutiIdx !== -1) {
              waitingMessage = `${rooms[roomId].game.ordered[dalmutiIdx].nickname}님이 농노에게 줄 카드를 선택하고 있습니다...`;
            } else if (archbishopIdx !== -1) {
              waitingMessage = `${rooms[roomId].game.ordered[archbishopIdx].nickname}님이 광부에게 줄 카드를 선택하고 있습니다...`;
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
      startGameAfterCardExchange(roomId);
    }

    // 카드 교환이 완료되면 게임이 시작됩니다 (dalmutiCardSelection 이벤트에서 처리)
    console.log('카드 교환 단계 시작...');
  }
}

// 카드 교환 완료 후 게임 시작 함수
function startGameAfterCardExchange(roomId) {
  console.log('=== startGameAfterCardExchange 함수 호출 ===');
  console.log('카드 교환 완료! 게임을 시작합니다.');
  console.log(`게임 진행 중: ${rooms[roomId].game.inProgress}`);
  console.log(`카드 교환 진행 중: ${rooms[roomId].game.cardExchangeInProgress}`);
  
  // 카드 교환 완료 플래그 및 상태 초기화
  rooms[roomId].game.cardExchangeInProgress = false;
  rooms[roomId].game.slaveCardsGiven = [];
  rooms[roomId].game.minerCardsGiven = [];
  rooms[roomId].game.dalmutiCardSelected = false;
  rooms[roomId].game.archbishopCardSelected = false;
  
  // 바로 게임 세팅 데이터 전송
  rooms[roomId].game.ordered.forEach((p, i) => {
    console.log(`${p.nickname}에게 gameSetup 전송 - 카드 ${rooms[roomId].game.playerHands[i].length}장`);
    io.to(p.id).emit('gameSetup', {
      ordered: rooms[roomId].game.ordered.map((p, i) => ({ ...p, cardCount: rooms[roomId].game.playerHands[i].length, finished: rooms[roomId].game.finished[i] })),
      myCards: rooms[roomId].game.playerHands[i],
      turnInfo: { turnIdx: rooms[roomId].game.turnIdx, currentPlayer: rooms[roomId].game.ordered[rooms[roomId].game.turnIdx], isFirstTurnOfRound: rooms[roomId].game.isFirstTurnOfRound },
      field: rooms[roomId].game.lastPlay
    });
  });
  console.log('gameSetup 데이터 전송 완료.');
}

function startTurnTimer(roomId) {
  const room = rooms[roomId];
  if (!room || !room.game) return;
  if (!room.timerEnabled) return; // 타이머 꺼져있으면 동작 안 함
  if (room.turnTimer) clearTimeout(room.turnTimer);
  // turnEndTime을 계산해서 모든 유저에게 broadcast
  const endTime = Date.now() + 30000;
  room.turnEndTime = endTime;
  io.to(roomId).emit('turnTimerStart', { endTime });
  room.turnTimer = setTimeout(() => {
    const currentPlayer = room.game.ordered[room.game.turnIdx];
    if (!room.game.finished[room.game.turnIdx]) {
      io.to(roomId).emit('turnTimeout'); // 클라이언트에 알림
      // 서버에서 자동 패스 처리
      autoPassTurn(roomId, currentPlayer.id);
    }
  }, 30000); // 30초
}

function clearTurnTimer(roomId) {
  const room = rooms[roomId];
  if (room && room.turnTimer) clearTimeout(room.turnTimer);
  if (room) room.turnTimer = null;
}

function autoPassTurn(roomId, socketId) {
  const idx = rooms[roomId].game.ordered.findIndex(p => p.id === socketId);
  if (!rooms[roomId].game.inProgress || idx !== rooms[roomId].game.turnIdx || rooms[roomId].game.finished[idx]) return;
  
  // 타임오버로 인한 자동 패스는 첫 턴이라도 허용
  console.log(`\n--- [autoPassTurn] ${rooms[roomId].game.ordered[idx].nickname}이 타임오버로 자동 패스됨 (첫 턴 여부: ${rooms[roomId].game.isFirstTurnOfRound}) ---`);
  
  rooms[roomId].game.passes++;
  io.to(roomId).emit('passResult', {playerIdx: idx, passes: rooms[roomId].game.passes});
  // 현재 게임에 참여 중인(완주하지 않은) 플레이어 수 계산
  const activePlayersCount = rooms[roomId].players.length - rooms[roomId].game.finished.filter(f => f).length;
  if (rooms[roomId].game.passes >= activePlayersCount-1 && activePlayersCount > 1) {
    rooms[roomId].game.passes = 0;
    if (rooms[roomId].game.lastPlay) {
      rooms[roomId].game.turnIdx = rooms[roomId].game.lastPlay.playerIdx;
      if (rooms[roomId].game.finished[rooms[roomId].game.turnIdx]) {
        do {
          rooms[roomId].game.turnIdx = (rooms[roomId].game.turnIdx + 1) % rooms[roomId].game.ordered.length;
        } while (rooms[roomId].game.finished[rooms[roomId].game.turnIdx]);
      }
    }
    rooms[roomId].game.lastPlay = null;
    rooms[roomId].game.isFirstTurnOfRound = true; // 새로운 라운드 시작 시 첫 턴 플래그 설정
    io.to(roomId).emit('newRound', {turnIdx: rooms[roomId].game.turnIdx, lastPlay: null, currentPlayer: rooms[roomId].game.ordered[rooms[roomId].game.turnIdx], isFirstTurnOfRound: true});
    startTurnTimer(roomId);
  } else if (activePlayersCount === 1) {
    // 플레이어가 1명만 남은 경우, 패스할 수 없고 카드를 내야 함
    // 패스 처리는 하지 않고 턴을 그대로 유지
  } else {
    do {
      rooms[roomId].game.turnIdx = (rooms[roomId].game.turnIdx + 1) % rooms[roomId].game.ordered.length;
    } while (rooms[roomId].game.finished[rooms[roomId].game.turnIdx]);
    io.to(roomId).emit('turnChanged', { turnIdx: rooms[roomId].game.turnIdx, currentPlayer: rooms[roomId].game.ordered[rooms[roomId].game.turnIdx], isFirstTurnOfRound: false });
    startTurnTimer(roomId);
  }
}

io.on('connection', (socket) => {
  socket.on('join', (data, callback) => {
    // data: { roomId, nickname }
    const { roomId, nickname: rawNickname } = data || {};
    if (!roomId || !rooms[roomId]) {
      return callback && callback({ success: false, message: '방이 존재하지 않습니다.' });
    }
    let nickname = (rawNickname || '').trim();
    if (!nickname) {
      return callback && callback({ success: false, message: '유효하지 않은 닉네임입니다.' });
    }
    socket.roomId = roomId;
    socket.nickname = nickname;
    socket.join(roomId); // join을 emit보다 먼저 호출

    // --- 게임 재접속 및 데이터 전송 로직 ---
    const room = rooms[roomId];
    if (room.game && room.game.inProgress) {
      const playerIndex = room.game.ordered.findIndex(p => p.nickname === nickname);
      if (playerIndex !== -1) {
        console.log(`게임 참가자 ${nickname}가 game.html에 연결했습니다.`);
        console.log(`이전 소켓 ID: ${rooms[socket.roomId].game.ordered[playerIndex].id}`);
        console.log(`새로운 소켓 ID: ${socket.id}`);
        
        // 새로운 소켓 ID로 플레이어 정보 업데이트
        rooms[socket.roomId].game.ordered[playerIndex].id = socket.id;
        const playerInLobbyList = rooms[socket.roomId].players.find(p => p.nickname === nickname);
        if (playerInLobbyList) playerInLobbyList.id = socket.id;

        console.log(`소켓 ID 업데이트 완료: ${nickname} -> ${socket.id}`);
        
        // --- 재접속 시 상태에 따른 분기 처리 ---
        if (rooms[socket.roomId].game.cardExchangeInProgress) {
          const dalmutiIdx = rooms[socket.roomId].game.ordered.findIndex(p => p.role === '달무티');
          const archbishopIdx = rooms[socket.roomId].game.ordered.findIndex(p => p.role === '대주교');
          const dalmuti = rooms[socket.roomId].game.ordered[dalmutiIdx];
          const archbishop = rooms[socket.roomId].game.ordered[archbishopIdx];

          if (playerIndex === dalmutiIdx) {
            // 재접속한 플레이어가 '달무티'인 경우
            console.log(`달무티 ${nickname} 재접속 - 카드 선택 요청을 다시 보냅니다.`);
            setTimeout(() => { // 클라이언트가 준비될 시간을 줍니다.
              io.to(socket.id).emit('selectCardsForSlave', {
                message: '농노에게 줄 카드 2장을 선택하세요.',
                hand: rooms[socket.roomId].game.playerHands[playerIndex]
              });
            }, 500);
          } else if (playerIndex === archbishopIdx) {
            // 재접속한 플레이어가 '대주교'인 경우
            console.log(`대주교 ${nickname} 재접속 - 카드 선택 요청을 다시 보냅니다.`);
            setTimeout(() => { // 클라이언트가 준비될 시간을 줍니다.
              io.to(socket.id).emit('selectCardsForMiner', {
                message: '광부에게 줄 카드 1장을 선택하세요.',
                hand: rooms[socket.roomId].game.playerHands[playerIndex]
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
            ordered: rooms[socket.roomId].game.ordered.map((p, i) => ({ ...p, cardCount: rooms[socket.roomId].game.playerHands[i].length, finished: rooms[socket.roomId].game.finished[i] })),
            myCards: rooms[socket.roomId].game.playerHands[playerIndex],
            turnInfo: { turnIdx: rooms[socket.roomId].game.turnIdx, currentPlayer: rooms[socket.roomId].game.ordered[rooms[socket.roomId].game.turnIdx], isFirstTurnOfRound: rooms[socket.roomId].game.isFirstTurnOfRound },
            field: rooms[socket.roomId].game.lastPlay
          });
        }
        
        return callback && callback({ success: true, inGame: true });
      }
    }

    // --- 로비 입장 로직 ---
    // 게임이 진행 중이 아닐 때만 중복 닉네임 체크
    const existingPlayer = room.players.find(p => p.nickname === nickname);
    if (existingPlayer) {
      return callback && callback({ success: false, message: '중복 닉네임' });
    }
    if (room.players.length >= (room.maxPlayers || MAX_PLAYERS)) {
      return callback && callback({ success: false, message: '최대 인원 초과' });
    }
    if (room.players.length < MIN_PLAYERS - 1) {
      room.players.push({ id: socket.id, nickname, ready: false });
    } else {
      if (!room.game || (!room.game.inProgress && !room.game.cardExchangeInProgress)) {
        room.players.push({ id: socket.id, nickname, ready: false });
      } else {
        return callback && callback({ success: false, message: '게임이 진행 중입니다' });
      }
    }
    io.to(socket.roomId).emit('players', { players: room.players, maxPlayers: room.maxPlayers || MAX_PLAYERS });
    callback && callback({ success: true });
  });

  socket.on('ready', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.ready = true;
    io.to(socket.roomId).emit('players', { players: room.players, maxPlayers: room.maxPlayers || MAX_PLAYERS });

    // 게임 객체가 없으면 전체 필드로 초기화
    if (!room.game) {
      room.game = {
        inProgress: false,
        ordered: [],
        turnIdx: 0,
        lastPlay: null,
        passes: 0,
        playerHands: [],
        finished: [],
        finishOrder: [],
        gameCount: 1,
        lastGameScores: {},
        totalScores: {},
        cardExchangeInProgress: false,
        slaveCardsGiven: [],
        minerCardsGiven: [],
        dalmutiCardSelected: false,
        archbishopCardSelected: false,
        isFirstTurnOfRound: false
      };
    }
    // 카드 교환 중이 아니면 게임 시작 체크
    if (!room.game.cardExchangeInProgress) {
      startGameIfReady(socket.roomId);
    }
  });

  socket.on('unready', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.ready = false;
    io.to(socket.roomId).emit('players', { players: room.players, maxPlayers: room.maxPlayers || MAX_PLAYERS });
  });

  socket.on('chat', (msg) => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const senderNickname = socket.nickname || 'Unknown';

    // 타이머 명령어 처리 복원
    if (msg === '!타이머on') {
      room.timerEnabled = true;
      io.to(socket.roomId).emit('chat', {nickname: 'SYSTEM', msg: '타이머가 켜졌습니다.'});
      io.to(socket.roomId).emit('timerStatus', { enabled: true });
      return;
    }
    if (msg === '!타이머off') {
      room.timerEnabled = false;
      io.to(socket.roomId).emit('chat', {nickname: 'SYSTEM', msg: '타이머가 꺼졌습니다.'});
      io.to(socket.roomId).emit('timerStatus', { enabled: false });
      return;
    }

    io.to(socket.roomId).emit('chat', {nickname: senderNickname, msg});
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      if (room.game && (room.game.inProgress || room.game.cardExchangeInProgress)) {
        // 게임 중 재접속 대기 - 플레이어는 제거하지 않음
        console.log(`게임 중 플레이어 ${player.nickname} 연결 끊김 - 재접속 대기`);
      } else {
        // 게임이 진행 중이 아닐 때만 플레이어 제거
        room.players = room.players.filter(p => p.id !== socket.id);
        io.to(socket.roomId).emit('players', { players: room.players, maxPlayers: room.maxPlayers || MAX_PLAYERS });
        socket.leave(socket.roomId); // 방에서 소켓 제거
      }
    }
    // 방에 아무도 없으면 방 삭제
    if (room.players.length === 0) deleteRoom(socket.roomId);
  });

  socket.on('leaveGame', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    
    // 게임 중단 상태에서도 정상적으로 처리되도록 수정
    const wasInGame = room.game && (room.game.inProgress || room.game.cardExchangeInProgress);
    
    // 플레이어 제거
    room.players = room.players.filter(p => p.id !== socket.id);
    
    // 게임이 진행 중이었다면 게임 중단 처리
    if (wasInGame) {
      resetGame(socket.roomId);
    } else {
      // 게임이 진행 중이 아니었다면 일반적인 플레이어 목록 업데이트
      io.to(socket.roomId).emit('players', { players: room.players, maxPlayers: room.maxPlayers || MAX_PLAYERS });
    }
    
    socket.leave(socket.roomId); // 방에서 소켓 제거
    
    // 방에 아무도 없으면 방 삭제
    if (room.players.length === 0) {
      deleteRoom(socket.roomId);
    }
    
    // 클라이언트 리셋은 마지막에 수행
    socket.emit('resetClient');
  });

  // --- 인게임 플레이 로직 ---
  socket.on('playCards', (cards, cb) => {
    const room = rooms[socket.roomId];
    if (!room || !room.game) return cb && cb({success: false, message: '방 또는 게임 정보가 없습니다.'});
    const idx = room.game.ordered.findIndex(p => p.id === socket.id);
    if (!room.game.inProgress || idx !== room.game.turnIdx || room.game.finished[idx]) {
      return cb && cb({success: false, message: '당신의 차례가 아니거나, 게임이 진행중이 아닙니다.'});
    }

    console.log(`\n--- [playCards] Event from ${rooms[socket.roomId].game.ordered[idx].nickname} (idx: ${idx}) ---`);
    console.log('Cards to play:', cards);
    
    // 유효성 검사 (중복 카드 제출 방지)
    const hand = rooms[socket.roomId].game.playerHands[idx];
    console.log(`Hand of ${rooms[socket.roomId].game.ordered[idx].nickname} BEFORE play: ${hand.length} cards -> [${hand.join(',')}]`);
    console.log('All hands BEFORE play:', JSON.stringify(rooms[socket.roomId].game.playerHands.map(h => h.length)));

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
    
    if (rooms[socket.roomId].game.lastPlay) {
      if (cards.length !== rooms[socket.roomId].game.lastPlay.count) return cb && cb({success: false, message: `이전과 같은 ${rooms[socket.roomId].game.lastPlay.count}장만 낼 수 있습니다.`});
      if (num >= rooms[socket.roomId].game.lastPlay.number) return cb && cb({success: false, message: '이전보다 낮은 숫자만 낼 수 있습니다.'});
    }
    
    // 제출 처리
    cards.forEach(c => {
      const cardIndexToRemove = hand.indexOf(c);
      if (cardIndexToRemove > -1) {
        hand.splice(cardIndexToRemove, 1);
      }
    });
    // 카드 제출 후 손패 정렬
    hand.sort((a, b) => (a === 'J' ? 13 : a) - (b === 'J' ? 13 : b));
    rooms[socket.roomId].game.lastPlay = {count: cards.length, number: num, playerIdx: idx, cards: [...cards]};
    rooms[socket.roomId].game.passes = 0;
    rooms[socket.roomId].game.isFirstTurnOfRound = false; // 카드를 내면 첫 턴 플래그 해제

    // 1 또는 1+조커를 낸 경우: 즉시 모든 미완주 플레이어 패스 처리 및 라운드 리셋
    if (num === 1) {
      // 현재 턴을 제외한 미완주 플레이어 인덱스
      const activeIdxs = rooms[socket.roomId].game.ordered.map((p, i) => i).filter(i => i !== idx && !rooms[socket.roomId].game.finished[i]);
      activeIdxs.forEach(i => {
        io.to(socket.roomId).emit('passResult', {playerIdx: i, passes: rooms[socket.roomId].game.passes + 1});
      });
      
      // 1을 낸 플레이어의 게임 완주 처리
      let justFinished = false;
      if (hand.length === 0) {
        if (!rooms[socket.roomId].game.finished[idx]) {
          rooms[socket.roomId].game.finished[idx] = true;
          rooms[socket.roomId].game.finishOrder.push(idx);
          justFinished = true;
          console.log(`*** ${rooms[socket.roomId].game.ordered[idx].nickname} has finished with 1! ***`);
        }
      }
      
      // 게임 종료 체크
      const finishedCount = rooms[socket.roomId].game.finished.filter(f => f).length;
      if (finishedCount >= rooms[socket.roomId].players.length - 1) {
        // 남은 한 명 자동 꼴찌 처리
        const lastIdx = rooms[socket.roomId].game.finished.findIndex(f => !f);
        if (lastIdx !== -1) {
          rooms[socket.roomId].game.finished[lastIdx] = true;
          rooms[socket.roomId].game.finishOrder.push(lastIdx);
        }
        console.log('모든 플레이어가 완주했습니다! 게임 종료.');
        // 인원에 따른 점수 배정
        let scores;
        if (rooms[socket.roomId].players.length === 4) {
          scores = [10, 8, 6, 4];
        } else if (rooms[socket.roomId].players.length === 5) {
          scores = [10, 8, 6, 5, 4];
        } else if (rooms[socket.roomId].players.length === 6) {
          scores = [10, 8, 6, 5, 4, 3];
        } else if (rooms[socket.roomId].players.length === 7) {
          scores = [10, 8, 6, 5, 4, 3, 2];
        } else if (rooms[socket.roomId].players.length === 8) {
          scores = [10, 8, 6, 5, 4, 3, 2, 1];
        }
        const result = rooms[socket.roomId].game.finishOrder.map((playerIdx, i) => {
          const nickname = rooms[socket.roomId].game.ordered[playerIdx].nickname;
          const role = rooms[socket.roomId].game.ordered[playerIdx].role;
          const score = scores[i] || 0;
          rooms[socket.roomId].game.lastGameScores[nickname] = score;
          rooms[socket.roomId].game.totalScores[nickname] = (rooms[socket.roomId].game.totalScores[nickname] || 0) + score;
          return {
            nickname,
            role,
            score,
            total: rooms[socket.roomId].game.totalScores[nickname]
          }
        });
        io.to(socket.roomId).emit('gameEnd', result);
        setTimeout(() => {
          rooms[socket.roomId].game.inProgress = false;
          rooms[socket.roomId].game.ordered = [];
          rooms[socket.roomId].game.turnIdx = 0;
          rooms[socket.roomId].game.lastPlay = null;
          rooms[socket.roomId].game.passes = 0;
          rooms[socket.roomId].game.playerHands = [];
          rooms[socket.roomId].game.finished = [];
          rooms[socket.roomId].game.finishOrder = [];
          rooms[socket.roomId].game.gameCount = (rooms[socket.roomId].game.gameCount || 1) + 1;
          startGameIfReady(socket.roomId);
        }, 5000);
        return;
      }
      
      if (justFinished) {
        // 완주한 경우: playResult를 한 번 더 보내서 클라가 완주자임을 인지하게 함
        rooms[socket.roomId].game.ordered.forEach((p, i) => {
          const targetSocket = io.sockets.sockets.get(p.id);
          if (targetSocket) {
            targetSocket.emit('playResult', {
              playerIdx: idx,
              cards,
              lastPlay: {count: cards.length, number: num, playerIdx: idx, cards: [...cards]},
              finished: rooms[socket.roomId].game.finished,
              playerHands: rooms[socket.roomId].game.playerHands.map(hand => hand.length),
              myCards: rooms[socket.roomId].game.playerHands[i]
            });
          }
        });
        // 그 다음 미완주자에게 턴 넘기기
        do {
          rooms[socket.roomId].game.turnIdx = (rooms[socket.roomId].game.turnIdx + 1) % rooms[socket.roomId].game.ordered.length;
        } while (rooms[socket.roomId].game.finished[rooms[socket.roomId].game.turnIdx]);
        io.to(socket.roomId).emit('turnChanged', {
          turnIdx: rooms[socket.roomId].game.turnIdx,
          currentPlayer: rooms[socket.roomId].game.ordered[rooms[socket.roomId].game.turnIdx],
          isFirstTurnOfRound: false
        });
        startTurnTimer(socket.roomId);
        cb && cb({success: true});
        return;
      }
      // 완주가 아니라면 기존대로 라운드 리셋
      rooms[socket.roomId].game.passes = 0;
      rooms[socket.roomId].game.turnIdx = idx;
      rooms[socket.roomId].game.lastPlay = null;
      rooms[socket.roomId].game.isFirstTurnOfRound = true; // 1을 내서 새로운 라운드 시작 시 첫 턴 플래그 설정
      setTimeout(() => {
        io.to(socket.roomId).emit('newRound', {turnIdx: rooms[socket.roomId].game.turnIdx, lastPlay: null, currentPlayer: rooms[socket.roomId].game.ordered[rooms[socket.roomId].game.turnIdx], isFirstTurnOfRound: true});
        startTurnTimer(socket.roomId);
      }, 400);
      clearTurnTimer(socket.roomId);
      rooms[socket.roomId].game.ordered.forEach((p, i) => {
        const targetSocket = io.sockets.sockets.get(p.id);
        if (targetSocket) {
          targetSocket.emit('playResult', {
            playerIdx: idx,
            cards,
            lastPlay: {count: cards.length, number: num, playerIdx: idx, cards: [...cards]},
            finished: rooms[socket.roomId].game.finished,
            playerHands: rooms[socket.roomId].game.playerHands.map(hand => hand.length),
            myCards: rooms[socket.roomId].game.playerHands[i]
          });
        }
      });
      cb && cb({success: true});
      return;
    }

    console.log(`Hand of ${rooms[socket.roomId].game.ordered[idx].nickname} AFTER play: ${hand.length} cards`);
    console.log('All hands AFTER play:', JSON.stringify(rooms[socket.roomId].game.playerHands.map(h => h.length)));
    
    if (hand.length === 0) {
      if (!rooms[socket.roomId].game.finished[idx]) {
        rooms[socket.roomId].game.finished[idx] = true;
        rooms[socket.roomId].game.finishOrder.push(idx);
        console.log(`*** ${rooms[socket.roomId].game.ordered[idx].nickname} has finished! ***`);
      }
    }

    console.log('`finished` array state:', JSON.stringify(rooms[socket.roomId].game.finished));
    
    clearTurnTimer(socket.roomId);
    rooms[socket.roomId].game.ordered.forEach((p, i) => {
      const targetSocket = io.sockets.sockets.get(p.id);
      if (targetSocket) {
        targetSocket.emit('playResult', {
          playerIdx: idx,
          cards,
          lastPlay: rooms[socket.roomId].game.lastPlay,
          finished: rooms[socket.roomId].game.finished,
          playerHands: rooms[socket.roomId].game.playerHands.map(hand => hand.length),
          myCards: rooms[socket.roomId].game.playerHands[i]
        });
      }
    });
    cb && cb({success: true});

    // 게임 종료 체크
    const finishedCount = rooms[socket.roomId].game.finished.filter(f => f).length;
    console.log(`게임 진행 상황: ${finishedCount}/${rooms[socket.roomId].players.length} 완주`);
    
    if (finishedCount >= rooms[socket.roomId].players.length - 1) { // 한 명만 남으면 게임 종료
      // 남은 한 명 자동 꼴찌 처리
      const lastIdx = rooms[socket.roomId].game.finished.findIndex(f => !f);
      if (lastIdx !== -1) {
        rooms[socket.roomId].game.finished[lastIdx] = true;
        rooms[socket.roomId].game.finishOrder.push(lastIdx);
      }
      console.log('모든 플레이어가 완주했습니다! 게임 종료.');
      
      // 인원에 따른 점수 배정
      let scores;
      if (rooms[socket.roomId].players.length === 4) {
        scores = [10, 8, 6, 4];
      } else if (rooms[socket.roomId].players.length === 5) {
        scores = [10, 8, 6, 5, 4];
      } else if (rooms[socket.roomId].players.length === 6) {
        scores = [10, 8, 6, 5, 4, 3];
      } else if (rooms[socket.roomId].players.length === 7) {
        scores = [10, 8, 6, 5, 4, 3, 2];
      } else if (rooms[socket.roomId].players.length === 8) {
        scores = [10, 8, 6, 5, 4, 3, 2, 1];
      }
      const result = rooms[socket.roomId].game.finishOrder.map((playerIdx, i) => {
        const nickname = rooms[socket.roomId].game.ordered[playerIdx].nickname;
        const role = rooms[socket.roomId].game.ordered[playerIdx].role;
        const score = scores[i] || 0;
        rooms[socket.roomId].game.lastGameScores[nickname] = score;
        rooms[socket.roomId].game.totalScores[nickname] = (rooms[socket.roomId].game.totalScores[nickname] || 0) + score;
        return {
          nickname,
          role,
          score,
          total: rooms[socket.roomId].game.totalScores[nickname]
        }
      });
      
      console.log('게임 종료! 최종 결과:', result);
      io.to(socket.roomId).emit('gameEnd', result);
      
      // 5초 후 자동으로 다음 게임 시작
      setTimeout(() => {
        // 게임 상태만 리셋 (점수, totalScores 등은 유지)
        rooms[socket.roomId].game.inProgress = false;
        rooms[socket.roomId].game.ordered = [];
        rooms[socket.roomId].game.turnIdx = 0;
        rooms[socket.roomId].game.lastPlay = null;
        rooms[socket.roomId].game.passes = 0;
        rooms[socket.roomId].game.playerHands = [];
        rooms[socket.roomId].game.finished = [];
        rooms[socket.roomId].game.finishOrder = [];
        rooms[socket.roomId].game.gameCount = (rooms[socket.roomId].game.gameCount || 1) + 1; // 게임 횟수 증가
        // lastGameScores, totalScores는 유지

        startGameIfReady(socket.roomId);
      }, 5000);
      return;
    }
    
    // 다음 턴
    do {
      rooms[socket.roomId].game.turnIdx = (rooms[socket.roomId].game.turnIdx + 1) % rooms[socket.roomId].game.ordered.length;
    } while (rooms[socket.roomId].game.finished[rooms[socket.roomId].game.turnIdx]);
    
    io.to(socket.roomId).emit('turnChanged', { turnIdx: rooms[socket.roomId].game.turnIdx, currentPlayer: rooms[socket.roomId].game.ordered[rooms[socket.roomId].game.turnIdx], isFirstTurnOfRound: false });
    startTurnTimer(socket.roomId);
  });
  
  socket.on('passTurn', (cb) => {
    const room = rooms[socket.roomId];
    if (!room || !room.game) return;
    const idx = room.game.ordered.findIndex(p => p.id === socket.id);
    if (!room.game.inProgress || idx !== room.game.turnIdx || room.game.finished[idx]) return;
    
    // 새로운 라운드의 첫 턴에는 패스할 수 없음
    if (rooms[socket.roomId].game.isFirstTurnOfRound) {
      console.log(`\n--- [passTurn] ${rooms[socket.roomId].game.ordered[idx].nickname}이 첫 턴에 패스 시도 - 거부됨 ---`);
      return cb && cb({success: false, message: '새로운 라운드의 첫 턴에는 패스할 수 없습니다. 카드를 내주세요.'});
    }
    
    clearTurnTimer(socket.roomId);
    rooms[socket.roomId].game.passes++;
    io.to(socket.roomId).emit('passResult', {playerIdx: idx, passes: rooms[socket.roomId].game.passes});

    console.log(`\n--- [passTurn] Event from ${rooms[socket.roomId].game.ordered[idx].nickname} (idx: ${idx}) ---`);
    console.log(`Current passes: ${rooms[socket.roomId].game.passes}`);
    
    // 현재 게임에 참여 중인(완주하지 않은) 플레이어 수 계산
    const activePlayersCount = rooms[socket.roomId].players.length - rooms[socket.roomId].game.finished.filter(f => f).length;
    console.log(`Active players: ${activePlayersCount}`);

    // 모두 패스 -> 라운드 리셋
    // 플레이어가 1명만 남은 경우는 패스하지 않고 카드를 내야 함
    if (rooms[socket.roomId].game.passes >= activePlayersCount-1 && activePlayersCount > 1) {
      console.log('*** All active players have passed. Starting a new round. ***');
      rooms[socket.roomId].game.passes = 0;
      // 마지막으로 카드를 낸 사람이 턴을 잡음
      if (rooms[socket.roomId].game.lastPlay) {
        rooms[socket.roomId].game.turnIdx = rooms[socket.roomId].game.lastPlay.playerIdx;
        // 마지막으로 카드를 낸 사람이 이미 완료했다면, 다음 완료하지 않은 플레이어에게 턴을 넘김
        if (rooms[socket.roomId].game.finished[rooms[socket.roomId].game.turnIdx]) {
          do {
            rooms[socket.roomId].game.turnIdx = (rooms[socket.roomId].game.turnIdx + 1) % rooms[socket.roomId].game.ordered.length;
          } while (rooms[socket.roomId].game.finished[rooms[socket.roomId].game.turnIdx]);
        }
      }
      // lastPlay가 null이면 (라운드 첫 턴에 모두 패스하는 비정상적 상황) 현재 턴 유지
      rooms[socket.roomId].game.lastPlay = null;
      rooms[socket.roomId].game.isFirstTurnOfRound = true; // 새로운 라운드 시작 시 첫 턴 플래그 설정
      io.to(socket.roomId).emit('newRound', {turnIdx: rooms[socket.roomId].game.turnIdx, lastPlay: null, currentPlayer: rooms[socket.roomId].game.ordered[rooms[socket.roomId].game.turnIdx], isFirstTurnOfRound: true});
      startTurnTimer(socket.roomId);
    } else if (activePlayersCount === 1) {
      // 플레이어가 1명만 남은 경우, 패스할 수 없고 카드를 내야 함
      console.log('*** Only one player remaining. Must play cards. ***');
      // 패스 처리는 하지 않고 턴을 그대로 유지
    } else {
      do {
        rooms[socket.roomId].game.turnIdx = (rooms[socket.roomId].game.turnIdx + 1) % rooms[socket.roomId].game.ordered.length;
      } while (rooms[socket.roomId].game.finished[rooms[socket.roomId].game.turnIdx]);
      io.to(socket.roomId).emit('turnChanged', { turnIdx: rooms[socket.roomId].game.turnIdx, currentPlayer: rooms[socket.roomId].game.ordered[rooms[socket.roomId].game.turnIdx], isFirstTurnOfRound: false });
      startTurnTimer(socket.roomId);
    }
    
    cb && cb({success: true});
  });

  // 달무티가 농노에게 줄 카드 선택
  socket.on('dalmutiCardSelection', (selectedCards, cb) => {
    const room = rooms[socket.roomId];
    if (!room || !room.game) return cb && cb({success: false, message: '방 또는 게임 정보가 없습니다.'});
    console.log('=== dalmutiCardSelection 이벤트 수신 ===');
    console.log(`요청한 소켓 ID: ${socket.id}`);
    console.log(`선택된 카드: [${selectedCards.join(',')}]`);
    
    const idx = room.game.ordered.findIndex(p => p.id === socket.id);
    const dalmutiIdx = room.game.ordered.findIndex(p => p.role === '달무티');
    
    console.log(`요청한 플레이어 인덱스: ${idx}`);
    console.log(`달무티 인덱스: ${dalmutiIdx}`);
    console.log(`카드 교환 진행 중: ${rooms[socket.roomId].game.cardExchangeInProgress}`);
    
    if (!rooms[socket.roomId].game.cardExchangeInProgress || idx !== dalmutiIdx) {
      console.log('카드 교환 조건 불충족 - 이벤트 무시');
      return cb && cb({success: false, message: '카드 교환 단계가 아니거나 달무티가 아닙니다.'});
    }
    
    if (selectedCards.length !== 2) {
      console.log('카드 개수 오류 - 이벤트 무시');
      return cb && cb({success: false, message: '정확히 2장의 카드를 선택해주세요.'});
    }
    
    // 선택된 카드가 손패에 있는지 확인
    const hand = [...rooms[socket.roomId].game.playerHands[idx]];
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
    const slaveIdx = rooms[socket.roomId].game.ordered.findIndex(p => p.role === '노예');
    console.log(`농노 인덱스: ${slaveIdx}`);
    
    selectedCards.forEach(card => {
      const cardIndex = rooms[socket.roomId].game.playerHands[idx].indexOf(card);
      if (cardIndex > -1) {
        rooms[socket.roomId].game.playerHands[idx].splice(cardIndex, 1);
        rooms[socket.roomId].game.playerHands[slaveIdx].push(card);
      }
    });
    
    // 카드 교환 후 손패 정렬
    rooms[socket.roomId].game.playerHands.forEach(hand => hand.sort((a, b) => (a === 'J' ? 13 : a) - (b === 'J' ? 13 : b)));
    console.log(`달무티(${rooms[socket.roomId].game.ordered[idx].nickname})가 농노에게 카드 전달: [${selectedCards.join(',')}]`);
    console.log(`달무티 최종 손패: [${rooms[socket.roomId].game.playerHands[idx].join(',')}]`);
    console.log(`농노 최종 손패: [${rooms[socket.roomId].game.playerHands[slaveIdx].join(',')}]`);
    
    // 카드 교환 완료 알림
    io.to(socket.roomId).emit('cardExchange', {
      slave: { nickname: rooms[socket.roomId].game.ordered[slaveIdx].nickname, cards: rooms[socket.roomId].game.slaveCardsGiven },
      dalmuti: { nickname: rooms[socket.roomId].game.ordered[idx].nickname, cards: selectedCards }
    });
    
    // 달무티 카드 선택 완료 상태 업데이트
    rooms[socket.roomId].game.dalmutiCardSelected = true;
    
    // 게임 시작 준비 완료
    cb && cb({success: true});
    
    // 대주교도 카드 선택을 완료했는지 확인
    const archbishopIdx = rooms[socket.roomId].game.ordered.findIndex(p => p.role === '대주교');
    if (archbishopIdx === -1 || rooms[socket.roomId].game.archbishopCardSelected) {
      // 대주교가 없거나 이미 카드 선택을 완료한 경우 게임 시작
      console.log('달무티 카드 선택 완료! 게임 시작 함수 호출');
      startGameAfterCardExchange(socket.roomId);
    } else {
      console.log('달무티 카드 선택 완료! 대주교 카드 선택 대기 중...');
    }
  });

  // 대주교가 광부에게 줄 카드 선택
  socket.on('archbishopCardSelection', (selectedCards, cb) => {
    const room = rooms[socket.roomId];
    if (!room || !room.game) return cb && cb({success: false, message: '방 또는 게임 정보가 없습니다.'});
    console.log('=== archbishopCardSelection 이벤트 수신 ===');
    console.log(`요청한 소켓 ID: ${socket.id}`);
    console.log(`선택된 카드: [${selectedCards.join(',')}]`);
    
    const idx = room.game.ordered.findIndex(p => p.id === socket.id);
    const archbishopIdx = room.game.ordered.findIndex(p => p.role === '대주교');
    
    console.log(`요청한 플레이어 인덱스: ${idx}`);
    console.log(`대주교 인덱스: ${archbishopIdx}`);
    console.log(`카드 교환 진행 중: ${rooms[socket.roomId].game.cardExchangeInProgress}`);
    
    if (!rooms[socket.roomId].game.cardExchangeInProgress || idx !== archbishopIdx) {
      console.log('카드 교환 조건 불충족 - 이벤트 무시');
      return cb && cb({success: false, message: '카드 교환 단계가 아니거나 대주교가 아닙니다.'});
    }
    
    if (selectedCards.length !== 1) {
      console.log('카드 개수 오류 - 이벤트 무시');
      return cb && cb({success: false, message: '정확히 1장의 카드를 선택해주세요.'});
    }
    
    // 선택된 카드가 손패에 있는지 확인
    const hand = [...rooms[socket.roomId].game.playerHands[idx]];
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
    const minerIdx = rooms[socket.roomId].game.ordered.findIndex(p => p.role === '광부');
    console.log(`광부 인덱스: ${minerIdx}`);
    
    selectedCards.forEach(card => {
      const cardIndex = rooms[socket.roomId].game.playerHands[idx].indexOf(card);
      if (cardIndex > -1) {
        rooms[socket.roomId].game.playerHands[idx].splice(cardIndex, 1);
        rooms[socket.roomId].game.playerHands[minerIdx].push(card);
      }
    });
    
    // 카드 교환 후 손패 정렬
    rooms[socket.roomId].game.playerHands.forEach(hand => hand.sort((a, b) => (a === 'J' ? 13 : a) - (b === 'J' ? 13 : b)));
    console.log(`대주교(${rooms[socket.roomId].game.ordered[idx].nickname})가 광부에게 카드 전달: [${selectedCards.join(',')}]`);
    console.log(`대주교 최종 손패: [${rooms[socket.roomId].game.playerHands[idx].join(',')}]`);
    console.log(`광부 최종 손패: [${rooms[socket.roomId].game.playerHands[minerIdx].join(',')}]`);
    
    // 카드 교환 완료 알림 (대주교-광부)
    io.to(socket.roomId).emit('cardExchange', {
      miner: { nickname: rooms[socket.roomId].game.ordered[minerIdx].nickname, cards: rooms[socket.roomId].game.minerCardsGiven },
      archbishop: { nickname: rooms[socket.roomId].game.ordered[idx].nickname, cards: selectedCards }
    });
    
    // 대주교 카드 선택 완료 상태 업데이트
    rooms[socket.roomId].game.archbishopCardSelected = true;
    
    // 게임 시작 준비 완료
    cb && cb({success: true});
    
    // 달무티도 카드 선택을 완료했는지 확인
    const dalmutiIdx = rooms[socket.roomId].game.ordered.findIndex(p => p.role === '달무티');
    if (dalmutiIdx === -1 || rooms[socket.roomId].game.dalmutiCardSelected) {
      // 달무티가 없거나 이미 카드 선택을 완료한 경우 게임 시작
      console.log('대주교 카드 선택 완료! 게임 시작 함수 호출');
      startGameAfterCardExchange(socket.roomId);
    } else {
      console.log('대주교 카드 선택 완료! 달무티 카드 선택 대기 중...');
    }
  });

  // 혁명 선택 결과 핸들러
  socket.on('revolutionResult', ({ revolution }) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId] || !rooms[roomId].game) return;
    if (revolution) {
      // 혁명 발생: 카드 교환 없이 바로 게임 시작
      io.to(roomId).emit('chat', { nickname: 'SYSTEM', msg: '혁명 발생! 카드 교환 없이 게임이 시작됩니다.' });
      // 클라이언트들이 준비될 시간을 주고 게임 시작
      setTimeout(() => {
        startGameAfterCardExchange(roomId);
      }, 1000);
    } else {
      // 기존 카드 교환 단계로 진행 (기존 코드 복사)
      const dalmutiIdx = rooms[roomId].game.ordered.findIndex(p => p.role === '달무티');
      const slaveIdx = rooms[roomId].game.ordered.findIndex(p => p.role === '노예');
      const minerIdx = rooms[roomId].game.ordered.findIndex(p => p.role === '광부');
      const archbishopIdx = rooms[roomId].game.ordered.findIndex(p => p.role === '대주교');
      if (dalmutiIdx !== -1 && slaveIdx !== -1) {
        // 농노의 손패에서 가장 낮은 숫자 2장 찾기 (자동)
        const slaveHand = [...rooms[roomId].game.playerHands[slaveIdx]];
        slaveHand.sort((a, b) => {
          const aVal = a === 'J' ? 13 : a;
          const bVal = b === 'J' ? 13 : b;
          return aVal - bVal;
        });
        const lowestCards = slaveHand.slice(0, 2);
        // 농노의 카드를 달무티에게 전달
        lowestCards.forEach(card => {
          const cardIndex = rooms[roomId].game.playerHands[slaveIdx].indexOf(card);
          if (cardIndex > -1) {
            rooms[roomId].game.playerHands[slaveIdx].splice(cardIndex, 1);
            rooms[roomId].game.playerHands[dalmutiIdx].push(card);
          }
        });
        // 카드 교환 후 손패 정렬
        rooms[roomId].game.playerHands.forEach(hand => hand.sort((a, b) => (a === 'J' ? 13 : a) - (b === 'J' ? 13 : b)));
        rooms[roomId].game.cardExchangeInProgress = true;
        rooms[roomId].game.slaveCardsGiven = lowestCards;
      }
      if (minerIdx !== -1 && archbishopIdx !== -1) {
        // 광부의 손패에서 가장 낮은 숫자 1장 찾기 (자동)
        const minerHand = [...rooms[roomId].game.playerHands[minerIdx]];
        minerHand.sort((a, b) => {
          const aVal = a === 'J' ? 13 : a;
          const bVal = b === 'J' ? 13 : b;
          return aVal - bVal;
        });
        const lowestCard = minerHand[0];
        // 광부의 카드를 대주교에게 전달
        const cardIndex = rooms[roomId].game.playerHands[minerIdx].indexOf(lowestCard);
        if (cardIndex > -1) {
          rooms[roomId].game.playerHands[minerIdx].splice(cardIndex, 1);
          rooms[roomId].game.playerHands[archbishopIdx].push(lowestCard);
        }
        // 카드 교환 후 손패 정렬
        rooms[roomId].game.playerHands.forEach(hand => hand.sort((a, b) => (a === 'J' ? 13 : a) - (b === 'J' ? 13 : b)));
        rooms[roomId].game.cardExchangeInProgress = true;
        rooms[roomId].game.minerCardsGiven = [lowestCard];
      }
      if (rooms[roomId].game.cardExchangeInProgress) {
        rooms[roomId].game.dalmutiCardSelected = false;
        rooms[roomId].game.archbishopCardSelected = false;
        io.to(roomId).emit('gameStart');
        setTimeout(() => {
          const dalmutiIdx = rooms[roomId].game.ordered.findIndex(p => p.role === '달무티');
          const archbishopIdx = rooms[roomId].game.ordered.findIndex(p => p.role === '대주교');
          if (dalmutiIdx !== -1 && slaveIdx !== -1) {
            io.to(rooms[roomId].game.ordered[dalmutiIdx].id).emit('selectCardsForSlave', {
              message: '농노에게 줄 카드 2장을 선택하세요.',
              hand: rooms[roomId].game.playerHands[dalmutiIdx]
            });
          }
          if (archbishopIdx !== -1 && minerIdx !== -1) {
            io.to(rooms[roomId].game.ordered[archbishopIdx].id).emit('selectCardsForMiner', {
              message: '광부에게 줄 카드 1장을 선택하세요.',
              hand: rooms[roomId].game.playerHands[archbishopIdx]
            });
          }
          rooms[roomId].game.ordered.forEach((p, i) => {
            if (i !== dalmutiIdx && i !== archbishopIdx) {
              let waitingMessage = '';
              if (dalmutiIdx !== -1 && archbishopIdx !== -1) {
                waitingMessage = `${rooms[roomId].game.ordered[dalmutiIdx].nickname}님과 ${rooms[roomId].game.ordered[archbishopIdx].nickname}님이 카드 교환을 진행하고 있습니다...`;
              } else if (dalmutiIdx !== -1) {
                waitingMessage = `${rooms[roomId].game.ordered[dalmutiIdx].nickname}님이 농노에게 줄 카드를 선택하고 있습니다...`;
              } else if (archbishopIdx !== -1) {
                waitingMessage = `${rooms[roomId].game.ordered[archbishopIdx].nickname}님이 광부에게 줄 카드를 선택하고 있습니다...`;
              }
              io.to(p.id).emit('waitingForCardExchange', { message: waitingMessage });
            }
          });
        }, 3000);
      } else {
        startGameAfterCardExchange(roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
}); 