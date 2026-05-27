const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// রুমের ডেটা ট্র্যাক করার অবজেক্ট (এখন ছবিও সেভ রাখবে)
let roomState = {
    seats: {}, // কোন সিটে কোন socket.id আছে { seatId: socketId }
    users: {}  // ইউজারের ডিটেইলস { socketId: { username, photo, seatId } }
};

app.get('/', (req, res) => {
    res.send('Sathi Audio Live Backend Server is Running Successfully!');
});

io.on('connection', (socket) => {
    console.log(`নতুন ইউজার কানেক্ট হয়েছে: ${socket.id}`);

    // ১. রুমে নতুন মেম্বার জয়েন করলে (নাম ও ছবিসহ)
    socket.on('join-room', (userData) => {
        // userData-এর ভেতর নাম এবং ছবি (Base64) দুইটাই থাকবে
        roomState.users[socket.id] = { 
            username: userData.username, 
            photo: userData.photo, 
            seatId: null 
        };
        
        // বর্তমান রুমে কোন কোন সিটে কারা বসা আছে তাদের একটা লিস্ট তৈরি করে পাঠানো
        let currentSeatsDetails = {};
        for (let seatId in roomState.seats) {
            let uId = roomState.seats[seatId];
            if (roomState.users[uId]) {
                currentSeatsDetails[seatId] = {
                    username: roomState.users[uId].username,
                    photo: roomState.users[uId].photo
                };
            }
        }
        
        socket.emit('current-room-state', currentSeatsDetails);
        socket.broadcast.emit('user-joined-notification', userData.username);
    });

    // ২. সিটে বসা বা নামার রিয়েল-টাইম আপডেট (ছবিসহ ব্রডকাস্ট)
    socket.on('toggle-seat', (seatId) => {
        const user = roomState.users[socket.id];
        if (!user) return;

        if (roomState.seats[seatId] === socket.id) {
            // সিট থেকে নেমে গেলে
            delete roomState.seats[seatId];
            user.seatId = null;
            io.emit('seat-updated', { seatId: seatId, username: null, photo: null, action: 'leave' });
        } else {
            // অন্য কোনো সিটে অলরেডি থাকলে সেটা আগে খালি করা (অটো ট্রান্সফার লজিক)
            for (let sId in roomState.seats) {
                if (roomState.seats[sId] === socket.id) {
                    delete roomState.seats[sId];
                    io.emit('seat-updated', { seatId: sId, username: null, photo: null, action: 'leave' });
                }
            }

            // নতুন সিটে বসানো
            roomState.seats[seatId] = socket.id;
            user.seatId = seatId;
            io.emit('seat-updated', { 
                seatId: seatId, 
                username: user.username, 
                photo: user.photo, 
                action: 'sit' 
            });
        }
    });

    // ৩. চ্যাট মেসেজ আদান-প্রদান
    socket.on('send-chat-message', (messageText) => {
        const user = roomState.users[socket.id];
        if (user) {
            io.emit('receive-chat-message', {
                username: user.username,
                text: messageText
            });
        }
    });

    // ৪. ইমোজি আপডেট
    socket.on('send-emoji', (emoji) => {
        const user = roomState.users[socket.id];
        if (user && user.seatId) {
            io.emit('receive-emoji', {
                seatId: user.seatId,
                emoji: emoji
            });
        }
    });

    // ৫. গিফট আপডেট
    socket.on('send-gift', (giftName) => {
        const user = roomState.users[socket.id];
        if (user) {
            io.emit('receive-gift', {
                username: user.username,
                giftName: giftName
            });
        }
    });

    // ৬. অডিও ভয়েস স্ট্রিম পাসিং
    socket.on('audio-stream', (audioData) => {
        const user = roomState.users[socket.id];
        if (user && user.seatId) {
            socket.broadcast.emit('receive-audio-stream', {
                senderId: socket.id,
                audio: audioData
            });
        }
    });

    // ৭. ইউজার ডিসকানেক্ট হলে সিট খালি করা
    socket.on('disconnect', () => {
        const user = roomState.users[socket.id];
        if (user) {
            if (user.seatId) {
                delete roomState.seats[user.seatId];
                io.emit('seat-updated', { seatId: user.seatId, username: null, photo: null, action: 'leave' });
            }
            io.emit('user-left-notification', user.username);
            delete roomState.users[socket.id];
        }
    });
});

server.listen(PORT, () => {
    console.log(`Sathi Audio Live সার্ভার চলছে পোর্ট: ${PORT}`);
});
