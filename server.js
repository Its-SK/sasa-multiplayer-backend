const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const WORDS = require('./words');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const activeRooms = {}; 

function generateRoomId() {
    let result = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // --- 1. ROOM SETUP ---
    socket.on('createRoom', (data, callback) => {
        const roomId = generateRoomId();
        activeRooms[roomId] = {
            players: [{ id: socket.id, name: data.playerName, score: 0 }],
            currentWord: '',
            drawerId: null,
            timer: null,
            timeLeft: 0,
            currentRound: 1,
            maxRounds: data.rounds || 3,
            turnIndex: -1,
            gameState: 'LOBBY'
        };
        socket.join(roomId);
        socket.roomId = roomId; 
        socket.playerName = data.playerName; 
        callback({ success: true, roomId: roomId });
        io.to(roomId).emit('gameStatus', `👋 ${data.playerName} created the room!`);
    });

    socket.on('joinRoom', (data, callback) => {
        const roomId = data.roomId.toUpperCase();
        if (activeRooms[roomId]) {
            activeRooms[roomId].players.push({ id: socket.id, name: data.playerName, score: 0 });
            socket.join(roomId);
            socket.roomId = roomId;
            socket.playerName = data.playerName;
            callback({ success: true, roomId: roomId });
            io.to(roomId).emit('gameStatus', `👋 ${data.playerName} joined the room!`);
        } else {
            callback({ success: false, message: "Room not found!" });
        }
    });

    // --- 2. GAME ENGINE LOOP ---
    socket.on('startGame', () => {
        const room = activeRooms[socket.roomId];
        if (!room || room.gameState !== 'LOBBY') return;
        room.gameState = 'PLAYING';
        io.to(socket.roomId).emit('gameStarted');
        advanceTurn(socket.roomId); // Kick off the first turn!
    });

    function advanceTurn(roomId) {
        const room = activeRooms[roomId];
        if (!room) return;
        if (room.timer) clearInterval(room.timer); // Stop old timer

        room.turnIndex++;
        // If everyone has drawn, move to the next round
        if (room.turnIndex >= room.players.length) {
            room.turnIndex = 0;
            room.currentRound++;
        }

        // Check if the game is over
        if (room.currentRound > room.maxRounds) {
            io.to(roomId).emit('gameStatus', `🏆 GAME OVER! Thanks for playing!`);
            room.gameState = 'LOBBY';
            room.turnIndex = -1;
            io.to(roomId).emit('gameOver');
            return;
        }

        // Start the next player's turn
        const drawer = room.players[room.turnIndex];
        if (!drawer) return; 
        
        room.drawerId = drawer.id;
        room.currentWord = '';
        io.to(roomId).emit('clearCanvas');
        io.to(roomId).emit('newTurn', { drawerId: drawer.id });
        io.to(roomId).emit('gameStatus', `🔄 Round ${room.currentRound}: ${drawer.name} is choosing a word!`);

        // Send 3 words ONLY to the drawer
        const choices = [];
        const wordsCopy = [...WORDS]; 
        for (let i = 0; i < 3; i++) {
            choices.push(wordsCopy.splice(Math.floor(Math.random() * wordsCopy.length), 1)[0]);
        }
        io.to(drawer.id).emit('yourTurn', choices);
    }

    // --- 3. GAMEPLAY ---
    socket.on('wordSelected', (word) => {
        const room = activeRooms[socket.roomId];
        if (!room || socket.id !== room.drawerId) return;

        room.currentWord = word;
        io.to(socket.roomId).emit('gameStatus', `🎨 Word selected! Start guessing!`);
        
        // Start the 120 Second Timer
        room.timeLeft = 120;
        io.to(socket.roomId).emit('timerUpdate', room.timeLeft);

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(socket.roomId).emit('timerUpdate', room.timeLeft);

            if (room.timeLeft <= 0) {
                clearInterval(room.timer);
                io.to(socket.roomId).emit('gameStatus', `⏰ Time's up! The word was "${room.currentWord}".`);
                setTimeout(() => advanceTurn(socket.roomId), 4000); // Wait 4 seconds, then next turn
            }
        }, 1000);
    });

    socket.on('chatMessage', (msg) => {
        if (!socket.roomId) return;
        const room = activeRooms[socket.roomId];
        
        // Correct Guess Check
        if (room && room.currentWord && msg.toLowerCase().trim() === room.currentWord.toLowerCase()) {
            if (socket.id === room.drawerId) return; // Drawer can't guess!

            io.to(socket.roomId).emit('gameStatus', `🎉 ${socket.playerName} guessed it! The word was "${room.currentWord}"! 🎉`);
            clearInterval(room.timer); // Stop the timer immediately
            room.currentWord = ''; 
            setTimeout(() => advanceTurn(socket.roomId), 4000); // Auto-forward to next turn after 4 secs
        } else {
            io.to(socket.roomId).emit('chatMessage', `<strong>${socket.playerName}:</strong> ${msg}`);
        }
    });

    socket.on('drawing', (data) => {
        if (!socket.roomId) return;
        socket.broadcast.to(socket.roomId).emit('drawing', data);
    });

    socket.on('clearCanvas', () => {
        if (!socket.roomId) return;
        io.to(socket.roomId).emit('clearCanvas');
    });

    socket.on('disconnect', () => {
        const room = activeRooms[socket.roomId];
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            io.to(socket.roomId).emit('gameStatus', `🚪 ${socket.playerName || 'Someone'} left the game.`);
            // If the drawer quits mid-turn, skip to the next turn so the game doesn't freeze
            if (room.drawerId === socket.id && room.gameState === 'PLAYING') {
                clearInterval(room.timer);
                advanceTurn(socket.roomId);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
