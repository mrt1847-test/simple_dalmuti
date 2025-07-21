# Simple Dalmuti

이 프로젝트는 보드게임 '달무티'를 웹에서 즐길 수 있도록 Node.js와 Socket.IO를 사용하여 구현한 간단한 멀티플레이어 웹 애플리케이션입니다.

## 📜 프로젝트 구성

### 🚀 주요 기술 스택

*   **Backend**: Node.js, Express.js
*   **Real-time Communication**: Socket.IO
*   **Frontend**: HTML, CSS, JavaScript (vanilla)

### 📂 파일 및 디렉토리 구조

```
simple_dalmuti/
├── server.js           # Express 서버 설정, Socket.IO 게임 로직 및 API 엔드포인트
├── index.html          # 초기 진입 페이지 (닉네임 설정 페이지로 리다이렉트)
├── join.html           # 사용자가 닉네임을 입력하는 페이지
├── room-list.html      # 생성된 게임 방 목록을 보여주는 페이지
├── lobby.html          # 게임 시작 전 플레이어들이 대기하는 방
├── game.html           # 실제 게임이 진행되는 페이지
├── img/                # 카드 이미지 파일 (1.png, 2.png, ..., j.png)
├── package.json        # 프로젝트 의존성 및 스크립트 정의
└── README.md           # 프로젝트 설명 파일
```

### ✨ 주요 파일 설명

*   **`server.js`**:
    *   Express를 사용하여 웹 서버를 생성하고 정적 파일(HTML, CSS, JS)을 제공합니다.
    *   `/api/create-room`, `/api/rooms`와 같은 REST API를 통해 방 생성 및 목록 조회를 처리합니다.
    *   Socket.IO를 통해 클라이언트와 실시간 양방향 통신을 구현합니다.
    *   플레이어의 접속, 퇴장, 준비, 채팅, 카드 제출 등 모든 게임 로직을 처리합니다.
    *   게임 상태(방 정보, 플레이어, 카드 등)를 서버 메모리에서 관리합니다.

*   **HTML 파일 (`index.html`, `join.html`, `room-list.html`, `lobby.html`, `game.html`)**:
    *   각각의 페이지는 게임의 특정 단계를 담당합니다.
    *   `join.html`에서 시작하여 `room-list.html` 또는 `lobby.html`을 거쳐 `game.html`에서 게임을 플레이하는 흐름으로 구성됩니다.
    *   각 HTML 파일 내의 `<script>` 태그를 통해 클라이언트 측 JavaScript 로직이 실행되어 서버와 통신합니다.

*   **`img/` 디렉토리**:
    *   게임에 사용되는 1부터 12까지의 숫자 카드와 조커(j.png) 이미지를 포함합니다.

## 🛠️ 실행 방법

1.  **의존성 설치**:
    프로젝트 디렉토리에서 다음 명령어를 실행하여 필요한 패키지를 설치합니다.
    ```bash
    npm install
    ```

2.  **서버 실행**:
    다음 명령어를 사용하여 서버를 시작합니다.
    ```bash
    npm start
    ```

3.  **애플리케이션 접속**:
    웹 브라우저를 열고 'https://simple-dalmuti.onrender.com' 주소로 접속합니다.