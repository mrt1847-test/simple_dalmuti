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

// 메인 진입 시 join.html로 리다이렉트
app.get('/', (req, res) => {
  res.redirect('/join.html');
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
    console.log('현재 players 상태:', players);
    startGameIfReady();
  });

  // 게임 시작 조건 함수로 분리
  function startGameIfReady() {
    console.log('startGameIfReady 호출됨, players:', players);
    if (players.length > 1 && players.length <= MAX_PLAYERS && players.every(p => p.ready)) {
      console.log('게임 시작 조건 충족!');
      io.emit('gameStart');
      console.log('gameStart emit');
      // 1~12 중 6개의 숫자를 랜덤으로 중복 없이 뽑아 각 플레이어에게 1개씩 배정
      const numbers = [];
      if (players.length > 12) {
        throw new Error('최대 12명까지만 입장할 수 있습니다.');
      }
      while (numbers.length < players.length) {
        const n = Math.floor(Math.random() * 12) + 1;
        if (!numbers.includes(n)) numbers.push(n);
      }
      try {
        players.forEach((p, i) => {
          io.to(p.id).emit('showNumber', numbers[i]);
          console.log(`showNumber emit to ${p.nickname}:`, numbers[i]);
        });
        console.log('gameStart emit2');
      } catch (e) {
        console.error('에러 발생:', e);
      }
      console.log('gameStart emit3');

      // 카드 선택 결과 저장용
      try{
        let picked = players.map((p, i) => ({ id: p.id, card: numbers[i] }));
      } catch (e) {
        console.error('에러 발생:', e);
      }
      console.log('gameStart emit4');
      io.once('showNumber', (data) => {}); // dummy to avoid warning
      io.emit('roleAssigned');
      console.log('gameStart emit5');
      io.on('connection', (socket) => {
        socket.on('playCards', (cards, cb) => {
          const idx = ordered.findIndex(p => p.id === socket.id);
          if (idx !== turnIdx || finished[idx]) return;
          // 유효성 검사
          if (cards.length === 0) return;
          const hand = playerHands[idx];
          // 같은 숫자만 제출 (조커는 예외)
          let num = null;
          let jokerCount = 0;
          for (const c of cards) {
            if (c === 'J') jokerCount++;
            else if (num === null) num = c;
            else if (c !== num) {
              cb && cb({success: false, message: '같은 숫자 또는 조커만 함께 제출할 수 있습니다.'});
              return;
            }
          }
          // 조커만 단독 제출 시
          if (jokerCount === cards.length) num = 13;
          // 손패에 있는지 확인
          for (const c of cards) {
            const i = hand.indexOf(c);
            if (i === -1) {
              cb && cb({success: false, message: '손패에 없는 카드를 제출했습니다.'});
              return;
            }
          }
          // 제출 규칙: 첫 턴은 제한 없음, 그 외엔 장수/숫자 체크
          if (lastPlay) {
            if (cards.length !== lastPlay.count) {
              cb && cb({success: false, message: '이전에 낸 카드와 같은 장수만 낼 수 있습니다.'});
              return;
            }
            if (num >= lastPlay.number) {
              cb && cb({success: false, message: '이전에 낸 카드보다 더 낮은 숫자만 낼 수 있습니다.'});
              return;
            }
          }
          // 제출 처리
          for (const c of cards) {
            hand.splice(hand.indexOf(c), 1);
          }
          lastPlay = {count: cards.length, number: num};
          passes = 0;
          if (hand.length === 0) {
            finished[idx] = true;
            finishOrder.push(idx);
          }
          // 게임 종료 체크
          const remain = playerHands.map((h, i) => (!finished[i] ? h.length : 0));
          if (finished.filter(f => f).length === ordered.length - 1) {
            // 게임 종료
            const lastIdx = finished.findIndex(f => !f);
            finishOrder.push(lastIdx);
            // 점수 부여
            const scores = [10, 8, 6, 5, 4, 3];
            const result = finishOrder.map((idx, i) => ({
              nickname: ordered[idx].nickname,
              role: ordered[idx].role,
              score: scores[i] || 0
            }));
            // 직전 게임 점수, 누적 점수 반영
            finishOrder.forEach((idx, i) => {
              lastGameScores[idx] = scores[i] || 0;
              totalScores[idx] += scores[i] || 0;
            });
            io.emit('gameEnd', result.map((r, i) => ({...r, total: totalScores[finishOrder[i]]})));
            // 5판이 끝났으면 최종 우승자 발표
            if (gameCount >= 5) {
              // 최종 점수 순위
              const finalOrder = totalScores.map((score, idx) => ({
                nickname: ordered[idx].nickname,
                score
              })).sort((a, b) => b.score - a.score);
              io.emit('finalResult', finalOrder);
              return;
            }
            // 다음 게임 준비: 신분/자리 재배정 (직전 게임 점수 순)
            setTimeout(() => {
              gameCount++;
              // 직전 게임 점수 높은 순서대로 신분/자리 재배정
              const idxOrder = lastGameScores.map((score, idx) => ({score, idx})).sort((a, b) => b.score - a.score).map(x => x.idx);
              const roles = ['달무티', '대주교', '평민', '평민', '광부', '노예'];
              const newOrdered = idxOrder.map((idx, i) => ({
                ...ordered[idx],
                role: roles[i]
              }));
              // 카드 분배 및 상태 초기화 (기존 로직 재사용)
              // 카드 덱 생성
              const deck = [];
              for (let i = 1; i <= 12; i++) {
                for (let j = 0; j < i; j++) {
                  deck.push(i);
                }
              }
              deck.push('J');
              deck.push('J'); // 조커 2장
              // 셔플
              for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
              }
              // 분배
              const hands = Array(newOrdered.length).fill(0).map(_ => []);
              for (let i = 0; i < 13 * newOrdered.length; i++) {
                hands[i % newOrdered.length].push(deck[i]);
              }
              // 남은 2장은 달무티에게
              const dalmutiOrderIdx = 0; // newOrdered[0]이 달무티
              hands[dalmutiOrderIdx].push(deck[13 * newOrdered.length], deck[13 * newOrdered.length + 1]);
              // 각 플레이어에게 카드 전송
              newOrdered.forEach((p, i) => {
                io.to(p.id).emit('dealCards', hands[i]);
              });
              // 게임 상태 초기화
              turnIdx = 0;
              lastPlay = null;
              passes = 0;
              playerHands = hands.map(h => h.slice());
              finished = Array(newOrdered.length).fill(false);
              finishOrder = [];
              ordered.splice(0, ordered.length, ...newOrdered);
              io.emit('roleAssigned', newOrdered);
              broadcastTurn();
            }, 4000);
            return;
          }
          io.emit('playResult', {playerIdx: idx, cards, lastPlay, finished});
          // 다음 차례
          do {
            turnIdx = (turnIdx + 1) % ordered.length;
          } while (finished[turnIdx]);
          broadcastTurn();
        });
        socket.on('passTurn', (cb) => {
          const idx = ordered.findIndex(p => p.id === socket.id);
          if (idx !== turnIdx || finished[idx]) return;
          passes++;
          io.emit('passResult', {playerIdx: idx, passes});
          // 모두 패스하면 lastPlay 초기화, 마지막 낸 사람이 시작
          if (passes >= ordered.length - finished.filter(f => f).length - 1) {
            passes = 0;
            // 마지막 낸 사람 찾기
            let lastIdx = turnIdx;
            for (let i = 1; i < ordered.length; i++) {
              const checkIdx = (turnIdx - i + ordered.length) % ordered.length;
              if (!finished[checkIdx]) {
                lastIdx = checkIdx;
                break;
              }
            }
            lastPlay = null;
            turnIdx = lastIdx;
            io.emit('newRound', {turnIdx, lastPlay: null});
          } else {
            // 다음 차례
            do {
              turnIdx = (turnIdx + 1) % ordered.length;
            } while (finished[turnIdx]);
          }
          broadcastTurn();
        });
      });
    }
  }

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
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
}); 