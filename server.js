const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

let waitingPlayer = null; // قائمة الانتظار
let rooms = {}; // لحفظ الغرف الشغالة

io.on('connection', (socket) => {
    
    // عندما يطلب لاعب الانضمام
    socket.on('joinGame', (playerName) => {
        socket.playerName = playerName;
        
        if (waitingPlayer) {
            // لقينا لاعب ناطر! بنعملهم غرفة جديدة
            const roomName = 'room_' + socket.id;
            socket.join(roomName);
            waitingPlayer.join(roomName);
            
            // تهيئة بيانات الغرفة والفيزياء
            rooms[roomName] = {
                p1: { id: waitingPlayer.id, name: waitingPlayer.playerName, x: 200, y: 520, score: 0 }, // الأزرق
                p2: { id: socket.id, name: playerName, x: 200, y: 80, score: 0 }, // الأحمر
                puck: { x: 200, y: 300, dx: 0, dy: 0 },
                gameOver: false
            };

            // إرسال رسالة البدء للاعبين
            io.to(waitingPlayer.id).emit('gameStart', { role: 1, opponentName: playerName });
            io.to(socket.id).emit('gameStart', { role: 2, opponentName: waitingPlayer.playerName });
            
            waitingPlayer = null; // تفريغ قائمة الانتظار

            // تشغيل محرك الفيزياء الخاص بهذه الغرفة فقط بالسيرفر
            rooms[roomName].interval = setInterval(() => {
                updatePhysics(roomName);
            }, 1000 / 40); // 40 إطار بالثانية

        } else {
            // مافي حد ناطر، خليه ينطر
            waitingPlayer = socket;
            socket.emit('waitingForOpponent');
        }
    });

    // استقبال حركة الماوس من اللاعبين
    socket.on('paddleMove', (data) => {
        let room = rooms[data.roomName];
        if (!room) return;

        // تحديث مكان اللاعب حسب دوره
        if (data.role === 1 && socket.id === room.p1.id) {
            room.p1.x = data.x; room.p1.y = data.y;
        } else if (data.role === 2 && socket.id === room.p2.id) {
            room.p2.x = data.x; room.p2.y = data.y;
        }
    });

    // عند خروج لاعب (تحديث الصفحة أو إغلاقها)
    socket.on('disconnect', () => {
        if (waitingPlayer && waitingPlayer.id === socket.id) {
            waitingPlayer = null; // إذا كان ناطر ومشي
            return;
        }
        
        // البحث عن غرفته وإنهائها
        for (let roomName in rooms) {
            let room = rooms[roomName];
            if (room.p1.id === socket.id || room.p2.id === socket.id) {
                let winnerName = (room.p1.id === socket.id) ? room.p2.name : room.p1.name;
                io.to(roomName).emit('opponentDisconnected', { winner: winnerName });
                clearInterval(room.interval);
                delete rooms[roomName];
                break;
            }
        }
    });
    
    // استقبال رسالة الخسارة وتمريرها
    socket.on('chatMessage', (data) => {
        socket.to(data.roomName).emit('chatMessage', data);
    });
});

// --- محرك الفيزياء (يعمل في السيرفر لضمان العدل والسرعة) ---
function updatePhysics(roomName) {
    let room = rooms[roomName];
    if (!room || room.gameOver) return;

    let p1 = room.p1; let p2 = room.p2; let puck = room.puck;
    const rPaddle = 25; const rPuck = 15;
    
    puck.x += puck.dx; puck.y += puck.dy;
    puck.dx *= 0.99; puck.dy *= 0.99; // احتكاك

    // الجدران الجانبية
    if (puck.x - rPuck < 0) { puck.x = rPuck; puck.dx *= -1; }
    if (puck.x + rPuck > 400) { puck.x = 400 - rPuck; puck.dx *= -1; }

    // المرمى (الأهداف)
    let goalLeft = 130; let goalRight = 270;

    // هدف للأزرق (تحت)
    if (puck.y - rPuck < 0) {
        if (puck.x > goalLeft && puck.x < goalRight) {
            p1.score++; resetPuck(puck); checkWin(room, roomName);
        } else { puck.y = rPuck; puck.dy *= -1; }
    }
    // هدف للأحمر (فوق)
    if (puck.y + rPuck > 600) {
        if (puck.x > goalLeft && puck.x < goalRight) {
            p2.score++; resetPuck(puck); checkWin(room, roomName);
        } else { puck.y = 600 - rPuck; puck.dy *= -1; }
    }

    // الاصطدام بالمضارب
    collide(p1, puck, rPaddle, rPuck);
    collide(p2, puck, rPaddle, rPuck);

    // إرسال النتيجة النهائية للحركة لكلا اللاعبين بنفس اللحظة!
    io.to(roomName).emit('gameState', { p1: p1, p2: p2, puck: puck });
}

function collide(paddle, p, rPaddle, rPuck) {
    let dx = p.x - paddle.x; let dy = p.y - paddle.y;
    let dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < rPaddle + rPuck) {
        let angle = Math.atan2(dy, dx);
        let speed = Math.sqrt(p.dx*p.dx + p.dy*p.dy) + 4;
        if (speed > 15) speed = 15;
        p.dx = Math.cos(angle) * speed; p.dy = Math.sin(angle) * speed;
        p.x = paddle.x + Math.cos(angle) * (rPaddle + rPuck + 1);
        p.y = paddle.y + Math.sin(angle) * (rPaddle + rPuck + 1);
    }
}

function resetPuck(puck) {
    puck.x = 200; puck.y = 300; puck.dx = 0; puck.dy = 0;
}

function checkWin(room, roomName) {
    if (room.p1.score >= 3 || room.p2.score >= 3) {
        room.gameOver = true;
        let winner = room.p1.score >= 3 ? room.p1 : room.p2;
        let loser = room.p1.score >= 3 ? room.p2 : room.p1;
        io.to(roomName).emit('gameOver', { winnerName: winner.name, loserName: loser.name });
        clearInterval(room.interval); // إيقاف اللعبة
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
