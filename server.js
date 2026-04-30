const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const activeRooms = {}; 

function generateRoomId() {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < 4; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // --- ROOM MANAGEMENT LOGIC ---
    socket.on('createRoom', (playerName, callback) => {
        const roomId = generateRoomId();
        
        activeRooms[roomId] = {
            currentWord: '',
            players: []
        };

        socket.join(roomId);
        socket.roomId = roomId; 
        socket.playerName = playerName; 
        
        callback({ success: true, roomId: roomId });
        io.to(roomId).emit('gameStatus', `👋 ${playerName} created the room!`);
    });

    socket.on('joinRoom', (data, callback) => {
        const roomId = data.roomId.toUpperCase();
        const playerName = data.playerName;

        if (activeRooms[roomId]) {
            socket.join(roomId);
            socket.roomId = roomId;
            socket.playerName = playerName;
            
            callback({ success: true, roomId: roomId });
            io.to(roomId).emit('gameStatus', `👋 ${playerName} joined the room!`);
        } else {
            callback({ success: false, message: "Room not found! Check the ID." });
        }
    });

    // --- FIXED: ENDLESS DICTIONARY API ---
    socket.on('requestWords', async () => {
        try {
            // We ask the internet for 3 random dictionary words instead of relying on a broken package
            const response = await fetch('https://random-word-api.herokuapp.com/word?number=3');
            const choices = await response.json();
            socket.emit('wordChoices', choices);
        } catch (error) {
            // If the dictionary API ever goes down, use these backups so the game doesn't break
            console.error("Dictionary API failed, using backups.");
            socket.emit('wordChoices', ['computer', 'building', 'ocean']);
        }
    });

    socket.on('wordSelected', (word) => {
        if (!socket.roomId) return;
        activeRooms[socket.roomId].currentWord = word;
        io.to(socket.roomId).emit('gameStatus', `🎨 ${socket.playerName} is choosing a word... Start guessing!`);
    });

    socket.on('chatMessage', (msg) => {
        if (!socket.roomId) return;
        
        const room = activeRooms[socket.roomId];
        
        if (room && room.currentWord && msg.toLowerCase().trim() === room.currentWord.toLowerCase()) {
            io.to(socket.roomId).emit('gameStatus', `🎉 ${socket.playerName} guessed it! The word was "${room.currentWord}"! 🎉`);
            room.currentWord = ''; 
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
        if (socket.roomId) {
            io.to(socket.roomId).emit('gameStatus', `🚪 ${socket.playerName || 'Someone'} left the game.`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
