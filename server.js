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
            gameState: 'LOBBY',
            correctGuessers: [] // Track who already guessed
        };
        socket.join(roomId);
        socket.roomId = roomId; 
        socket.playerName = data.playerName; 
        callback({ success: true, roomId: roomId });
        io.to(roomId).emit('gameStatus', `👋 ${data.playerName} created the room!`);
        io.to(roomId).emit('updateScores', activeRooms[roomId].players);
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
            io.to(roomId).emit('updateScores', activeRooms[roomId].players);
        } else {
            callback({ success: false, message: "Room not found!" });
        }
    });

    // --- 2. GAME ENGINE LOOP ---
    socket.on('startGame', () => {
        const room = activeRooms[socket.roomId];
        if (!room || room.gameState !== 'LOBBY') return;
        
        // BUG FIX: Reset the entire game state so it can be replayed!
        room.gameState = 'PLAYING';
        room.currentRound = 1;
        room.turnIndex = -1;
        room.players.forEach(p => p.score = 0); // Reset scores to 0
        io.to(socket.roomId).emit('updateScores', room.players);

        io.to(socket.roomId).emit('gameStarted');
        advanceTurn(socket.roomId); 
    });

    function advanceTurn(roomId) {
        const room = activeRooms[roomId];
        if (!room) return;
        if (room.timer) clearInterval(room.timer); 

        // Reset the guessers list for the new turn
        room.correctGuessers = []; 
        io.to(roomId).emit('updateScores', room.players);

        room.turnIndex++;
        if (room.turnIndex >= room.players.length) {
            room.turnIndex = 0;
            room.currentRound++;
        }

        // GAME OVER CHECK
        if (room.currentRound > room.maxRounds) {
            io.to(roomId).emit('gameStatus', `🏆 GAME OVER! Final Scores!`);
            room.gameState = 'LOBBY';
            
            // Sort players by score to figure out who won
            const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
            
            // Send the sorted player list to the frontend to populate the popup
            io.to(roomId).emit('gameOver', sortedPlayers); 
            return;
        }

        const drawer = room.players[room.turnIndex];
        if (!drawer) return; 
        
        room.drawerId = drawer.id;
        room.currentWord = '';
        io.to(roomId).emit('clearCanvas');
        io.to(roomId).emit('newTurn', { drawerId: drawer.id });
        io.to(roomId).emit('gameStatus', `🔄 Round ${room.currentRound}: ${drawer.name} is choosing a word!`);

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
        
        room.timeLeft = 120;
        io.to(socket.roomId).emit('timerUpdate', room.timeLeft);

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(socket.roomId).emit('timerUpdate', room.timeLeft);

            if (room.timeLeft <= 0) {
                clearInterval(room.timer);
                io.to(socket.roomId).emit('gameStatus', `⏰ Time's up! The word was "${room.currentWord}".`);
                setTimeout(() => advanceTurn(socket.roomId), 4000); 
            }
        }, 1000);
    });

    socket.on('chatMessage', (msg) => {
        if (!socket.roomId) return;
        const room = activeRooms[socket.roomId];
        if (!room) return;
        
        // --- UPDATED POINT SYSTEM & HIDDEN GUESS LOGIC ---
        if (room.gameState === 'PLAYING' && room.currentWord && msg.toLowerCase().trim() === room.currentWord.toLowerCase()) {
            
            if (socket.id === room.drawerId) return; // Drawer cannot guess their own word
            if (room.correctGuessers.includes(socket.id)) return; // Prevent spamming for infinite points

            // Add player to the list of people who guessed it this round
            room.correctGuessers.push(socket.id);

            // Calculate points: Math.floor((Time Left / Total Time) * Max Points). Max is 50.
            const points = Math.max(5, Math.floor((room.timeLeft / 120) * 50));
            
            // Give points to the Guesser
            const player = room.players.find(p => p.id === socket.id);
            if (player) player.score += points;

            // Give 25 points to the Drawer
            const drawer = room.players.find(p => p.id === room.drawerId);
            if (drawer) drawer.score += 25; 

            // Broadcast the hidden success message (DOES NOT show the word!)
            io.to(socket.roomId).emit('gameStatus', `🎉 ${socket.playerName} guessed the word! (+${points} pts)`);
            io.to(socket.roomId).emit('updateScores', room.players); // Update UI immediately

            // Check if EVERYONE (except the drawer) has guessed it
            if (room.correctGuessers.length >= room.players.length - 1) {
                clearInterval(room.timer);
                io.to(socket.roomId).emit('gameStatus', `✨ Everyone guessed it! The word was "${room.currentWord}".`);
                setTimeout(() => advanceTurn(socket.roomId), 4000); // Skip the rest of the timer!
            }

        } else {
            // It wasn't the right word, broadcast it like normal chat
            io.to(socket.roomId).emit('chatMessage', `<strong>${socket.playerName}:</strong> ${msg}`);
        }
    });

    // --- DRAWING LOGIC ---
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
            io.to(socket.roomId).emit('updateScores', room.players);

            if (room.drawerId === socket.id && room.gameState === 'PLAYING') {
                clearInterval(room.timer);
                advanceTurn(socket.roomId);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
