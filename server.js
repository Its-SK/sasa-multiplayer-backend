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

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Broadcast drawing data
    socket.on('drawing', (data) => {
        socket.broadcast.emit('drawing', data);
    });

    // Broadcast chat messages
    socket.on('chatMessage', (msg) => {
        io.emit('chatMessage', msg);
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