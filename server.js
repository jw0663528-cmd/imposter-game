const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { categories, wordList } = require('./words');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve files from the root directory (compatible with your Render setup)
app.use(express.static(__dirname));

const rooms = {};

io.on('connection', (socket) => {
    
    // Create Lobby
    socket.on('createLobby', () => {
        const roomId = Math.floor(1000000000 + Math.random() * 9000000000).toString();
        
        rooms[roomId] = {
            players: [],
            hostId: socket.id,
            isPlaying: false,
            // Added timerDuration default (10 minutes)
            settings: { imposters: 1, category: categories[0], timerDuration: 10 },
            readyCount: 0
        };
        
        joinRoomLogic(socket, roomId, true);
        socket.emit('lobbyCreated', { roomId, categories: categories });
    });

    // Join Lobby
    socket.on('joinLobby', (roomId) => {
        if (rooms[roomId] && !rooms[roomId].isPlaying) {
            joinRoomLogic(socket, roomId, false);
        } else {
            socket.emit('error', 'Room not found or game already started.');
        }
    });

    // Update Settings (Host Only)
    socket.on('updateSettings', ({ roomId, setting, value }) => {
        if (rooms[roomId] && rooms[roomId].hostId === socket.id) {
            rooms[roomId].settings[setting] = value;
            // Broadcast new settings to everyone in the room (so they see updates)
            io.to(roomId).emit('updateLobbyUI', rooms[roomId]);
        }
    });

    // Start Game
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.hostId !== socket.id) return;

        const category = room.settings.category;
        // Fallback to 'Vehicles' if category is empty
        const availableWords = wordList[category] || wordList['Vehicles']; 
        
        // 1. Select random word
        const secretData = availableWords[Math.floor(Math.random() * availableWords.length)];
        
        // 2. Assign Imposters
        let playerIds = room.players.map(p => p.id);
        let imposters = [];
        
        // Ensure we don't have more imposters than players-1
        let maxImposters = Math.max(1, playerIds.length - 1);
        let imposterCount = Math.min(parseInt(room.settings.imposters), maxImposters);
        
        while (imposters.length < imposterCount) {
            const randIndex = Math.floor(Math.random() * playerIds.length);
            const selected = playerIds.splice(randIndex, 1)[0];
            imposters.push(selected);
        }

        // 3. Determine who starts
        const startingPlayer = room.players[Math.floor(Math.random() * room.players.length)].name;

        // 4. Distribute Roles
        room.players.forEach(player => {
            const isImposter = imposters.includes(player.id);
            io.to(player.id).emit('gameStarted', {
                isImposter,
                category: category, // Send category to everyone
                wordData: isImposter ? null : secretData,
                startingPlayer
            });
        });

        room.isPlaying = true;
        room.readyCount = 0; 
    });

    // Player clicked "Continue"
    socket.on('playerReady', (roomId) => {
        if (!rooms[roomId]) return;
        rooms[roomId].readyCount = (rooms[roomId].readyCount || 0) + 1;

        if (rooms[roomId].readyCount === rooms[roomId].players.length) {
            // Send the timer duration to start the clock
            io.to(roomId).emit('allReady', { duration: rooms[roomId].settings.timerDuration });
        }
    });

    // Leave Room (Return to Home)
    socket.on('leaveRoom', (roomId) => {
        leaveRoomLogic(socket, roomId);
    });

    socket.on('disconnect', () => {
        // Find which room the player was in (if any)
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                leaveRoomLogic(socket, roomId);
                break;
            }
        }
    });
});

function joinRoomLogic(socket, roomId, isHost) {
    const room = rooms[roomId];
    const playerNumber = room.players.length + 1;
    const playerName = `Player${playerNumber}`;

    const player = { id: socket.id, name: playerName, isHost };
    room.players.push(player);
    socket.join(roomId);

    socket.emit('joinedRoom', { roomId, playerName, isHost, categories });
    io.to(roomId).emit('updateLobbyUI', room);
}

function leaveRoomLogic(socket, roomId) {
    if (!rooms[roomId]) return;

    const room = rooms[roomId];
    // Remove player
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(roomId);

    // If room is empty, delete it
    if (room.players.length === 0) {
        delete rooms[roomId];
    } else {
        // If host left, assign new host (optional improvement, currently just keeps running)
        if (room.hostId === socket.id) {
             room.hostId = room.players[0].id; // Assign to next player
             room.players[0].isHost = true;
        }
        io.to(roomId).emit('updateLobbyUI', room);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
