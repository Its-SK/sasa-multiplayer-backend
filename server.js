const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); // Allow cross-origin requests

const server = http.createServer(app);

// Configure Socket.io to accept connections from your domain
const io = new Server(server, {
    cors: {
        origin: "*", // You can restrict this to "https://sasasollutions.tech" later for security
        methods: ["GET", "POST"]
    }
});

// --- NEW: Word List and Game State ---
const WORDS = ['apple', 'car', 'tree', 'dog', 'house', 'computer', 'pizza', 'ocean', 'guitar', 'mountain', 'sun', 'moon', 'star', 'book', 'chair'];
let currentWord = ''; // Keeps track of the word currently being drawn

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // --- NEW: Request Words Logic ---
    socket.on('requestWords', () => {
        // Pick 3 random words from the list
        const choices = [];
        const wordsCopy = [...WORDS]; // Make a copy so we don't modify the original list
        
        for (let i = 0; i < 3; i++) {
            const randomIndex = Math.floor(Math.random() * wordsCopy.length);
            choices.push(wordsCopy.splice(randomIndex, 1)[0]);
        }
        
        // Send the 3 choices back ONLY to the person who requested them
        socket.emit('wordChoices', choices);
    });

    // --- NEW: Select Word Logic ---
    socket.on('wordSelected', (word) => {
        currentWord = word;
        // Tell everyone that a word has been chosen (but don't tell them what it is!)
        io.emit('gameStatus', `A word has been chosen! Start guessing!`);
    });

    // --- UPDATED: Chat Message Logic ---
    socket.on('chatMessage', (msg) => {
        // Check if a word has been selected AND if the message matches it
        if (currentWord && msg.toLowerCase().trim() === currentWord.toLowerCase()) {
            // Someone guessed it!
            io.emit('gameStatus', `🎉 Someone guessed the word correctly! The word was "${currentWord}"! 🎉`);
            currentWord = ''; // Reset the word so nobody else can guess it
        } else {
            // Normal chat message
            io.emit('chatMessage', msg);
        }
    });

    // Broadcast drawing data
    socket.on('drawing', (data) => {
        socket.broadcast.emit('drawing', data);
    });

    // Clear canvas for all
    socket.on('clearCanvas', () => {
        io.emit('clearCanvas');
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});