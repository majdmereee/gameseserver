const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};

io.on('connection', (socket) => {
    
    // عندما يطلب لاعب دخول غرفة
    socket.on('joinRoom', (data) => {
        const { playerName, roomCode } = data;
        socket.join(roomCode);
        socket.playerName = playerName;
        socket.roomCode = roomCode;

        if (!rooms[roomCode]) {
            rooms[roomCode] = { 
                players: {}, puck: { x: 200, y: 300, dx: 0, dy: 0, r: 15 },
                state: 'waiting', score: { p1: 0, p2: 0 } 
            };
        }

        const room = rooms[roomCode];
        const playerCount = Object.keys(room.players).length;

        if (playerCount === 0) {
            // اللاعب الأول يدخل وينتظر
            room.players[socket.id] = { role: 1, name: playerName, x: 200, y: 520, r: 25 };
            socket.emit('joined', { role: 1, state: 'waiting' });
        } 
        else if (playerCount === 1) {
            // اللاعب الثاني دخل، المباراة تبدأ فوراً!
            room.players[socket.id] = { role: 2, name: playerName, x: 200, y: 80, r: 25 };
            room.state = 'playing';
            socket.emit('joined', { role: 2, state: 'playing' });

            const p1 = Object.values(room.players).find(p => p.role === 1);
            const p2 = Object.values(room.players).find(p => p.role === 2);

            // إرسال إشارة البدء للجميع في الغرفة
            io.to(roomCode).emit('gameStart', { p1Name: p1.name, p2Name: p2.name });

            // تشغيل محرك الفيزياء للسيرفر (40 إطار بالثانية)
            room.interval = setInterval(() => updatePhysics(roomCode), 1000 / 40);
        } 
        else {
            socket.emit('roomFull'); // الغرفة ممتلئة
        }
    });

    // استقبال حركة اللاعبين
    socket.on('move', (data) => {
        if (!socket.roomCode || !rooms[socket.roomCode]) return;
        const player = rooms[socket.roomCode].players[socket.id];
        if (player) {
            player.x = data.x; player.y = data.y;
        }
    });

    // رسائل الشات (تصبح على خير)
    socket.on('chatMessage', (data) => {
        socket.to(socket.roomCode).emit('chatMessage', data);
    });

    // عند انسحاب لاعب
    socket.on('disconnect', () => {
        const roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode]) {
            io.to(roomCode).emit('playerLeft');
            clearInterval(rooms[roomCode].interval);
            delete rooms[roomCode]; // تدمير الغرفة
        }
    });
});

// السيرفر هو الحكم الذي يحسب الفيزياء
function updatePhysics(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.state !== 'playing') return;

    const puck = room.puck;
    const p1 = Object.values(room.players).find(p => p.role === 1);
    const p2 = Object.values(room.players).find(p => p.role === 2);

    puck.x += puck.dx; puck.y += puck.dy;
    puck.dx *= 0.99; puck.dy *= 0.99;

    if (puck.x - puck.r < 0) { puck.x = puck.r; puck.dx *= -1; }
    if (puck.x + puck.r > 400) { puck.x = 400 - puck.r; puck.dx *= -1; }

    const goalLeft = 130, goalRight = 270;

    if (puck.y + puck.r > 600) {
        if (puck.x > goalLeft && puck.x < goalRight) { room.score.p2++; checkWin(roomCode); } 
        else { puck.y = 600 - puck.r; puck.dy *= -1; }
    }
    if (puck.y - puck.r < 0) {
        if (puck.x > goalLeft && puck.x < goalRight) { room.score.p1++; checkWin(roomCode); } 
        else { puck.y = puck.r; puck.dy *= -1; }
    }

    collide(p1, puck); collide(p2, puck);

    // إرسال النتيجة النهائية للحركة لكلا اللاعبين بنفس اللحظة تماماً
    io.to(roomCode).emit('gameState', { puck, p1, p2, score: room.score });
}

function collide(paddle, p) {
    let dx = p.x - paddle.x, dy = p.y - paddle.y;
    let dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < paddle.r + p.r) {
        let angle = Math.atan2(dy, dx);
        let speed = Math.sqrt(p.dx*p.dx + p.dy*p.dy) + 4;
        if (speed > 15) speed = 15;
        p.dx = Math.cos(angle) * speed; p.dy = Math.sin(angle) * speed;
        p.x = paddle.x + Math.cos(angle) * (paddle.r + p.r + 1);
        p.y = paddle.y + Math.sin(angle) * (paddle.r + p.r + 1);
    }
}

function checkWin(roomCode) {
    const room = rooms[roomCode];
    room.puck.x = 200; room.puck.y = 300; room.puck.dx = 0; room.puck.dy = 0; // إرجاع القرص للمنتصف
    
    if (room.score.p1 >= 3 || room.score.p2 >= 3) {
        room.state = 'ended';
        const winnerRole = room.score.p1 >= 3 ? 1 : 2;
        const winnerName = Object.values(room.players).find(p => p.role === winnerRole).name;
        io.to(roomCode).emit('gameOver', { winnerRole, winnerName });
        clearInterval(room.interval);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running'));
