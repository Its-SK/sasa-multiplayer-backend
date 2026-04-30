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

const WORDS = [
    // Animals
    'elephant', 'tiger', 'spider', 'snake', 'turtle', 
    'dolphin', 'dinosaur', 'penguin', 'giraffe', 'monkey',
    
    // Food
    'apple', 'banana', 'pizza', 'hamburger', 'ice cream',
    'donut', 'cookie', 'watermelon', 'taco', 'cheese',
    
    // Objects & Things
    'guitar', 'computer', 'clock', 'glasses', 'camera',
    'telephone', 'book', 'pencil', 'scissors', 'umbrella',
    
    // Places & Nature
    'mountain', 'volcano', 'house', 'castle', 'bridge',
    'snowflake', 'snowman', 'rainbow', 'tree', 'flower',
    
    // Sci-Fi & Fantasy
    'rocket', 'astronaut', 'alien', 'robot', 'dragon',
    'unicorn', 'ghost', 'zombie', 'crown', 'sword'
];

// NEW: Keep track of active rooms and their specific game states
const activeRooms = {}; 

// Helper function to generate a random 4-letter Room ID
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

    // 1. Create a Room
    socket.on('createRoom', (playerName, callback) => {
        const roomId = generateRoomId();
        
        // Initialize room state
        activeRooms[roomId] = {
            currentWord: '',
            players: []
        };

        socket.join(roomId);
        socket.roomId = roomId; // Remember which room this socket is in
        socket.playerName = playerName; // Remember the player's name
        
        callback({ success: true, roomId: roomId });
        io.to(roomId).emit('gameStatus', `👋 ${playerName} created the room!`);
    });

    // 2. Join a Room
    socket.on('joinRoom', (data, callback) => {
        const roomId = data.roomId.toUpperCase();
        const playerName = data.playerName;

        // Check if the room exists
        if (activeRooms[roomId]) {
            socket.join(roomId);
            socket.roomId = roomId;
            socket.playerName = playerName;
            
            callback({ success: true, roomId: roomId });
            io.to(roomId).emit('gameStatus', `👋 ${playerName} joined the room!`);
        } else {
            // Room doesn't exist
            callback({ success: false, message: "Room not found! Check the ID." });
        }
    });

    // --- GAME LOGIC (Now Room-Specific) ---

    socket.on('requestWords', () => {
        const choices = [];
        const wordsCopy = [...WORDS]; 
        for (let i = 0; i < 3; i++) {
            const randomIndex = Math.floor(Math.random() * wordsCopy.length);
            choices.push(wordsCopy.splice(randomIndex, 1)[0]);
        }
        socket.emit('wordChoices', choices);
    });

    socket.on('wordSelected', (word) => {
        if (!socket.roomId) return;
        activeRooms[socket.roomId].currentWord = word;
        // Use io.to(roomId).emit to ONLY broadcast to this specific room
        io.to(socket.roomId).emit('gameStatus', `🎨 ${socket.playerName} is choosing a word... Start guessing!`);
    });

    socket.on('chatMessage', (msg) => {
        if (!socket.roomId) return;
        
        const room = activeRooms[socket.roomId];
        
        // Check for correct guess
        if (room && room.currentWord && msg.toLowerCase().trim() === room.currentWord.toLowerCase()) {
            io.to(socket.roomId).emit('gameStatus', `🎉 ${socket.playerName} guessed it! The word was "${room.currentWord}"! 🎉`);
            room.currentWord = ''; // Reset word
        } else {
            // Normal chat message - attach player name!
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
