const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

// সার্ভার পোর্ট সেটআপ (Render বা অন্যান্য হোস্টিং অটোমেটিক পোর্ট অ্যাসাইন করে)
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", // যেকোনো ফ্রন্ট-এন্ড (গিটহাব পেজ) থেকে কানেক্ট করার অনুমতি
        methods: ["GET", "POST"]
    }
});

// রুমের ডেটা ট্র্যাক করার জন্য অবজেক্ট
let roomState = {
    seats: {}, // কোন সিটে কে আছে তা সেভ থাকবে
    users: {}  // টোটাল লাইভ ইউজারের লিস্ট
};

// রুট পাথ চেক করার জন্য (সার্ভার লাইভ আছে কিনা দেখার জন্য)
app.get('/', (req, res) => {
    res.send('Sathi Audio Live Backend Server is Running Successfully!');
});

io.on('connection', (socket) => {
    console.log(`নতুন ইউজার কানেক্ট হয়েছে: ${socket.id}`);

    // ১. রুমে নতুন মেম্বার জয়েন করলে
    socket.on('join-room', (username) => {
        roomState.users[socket.id] = { username: username, seatId: null };
        
        // নতুন ইউজারকে বর্তমান রুমের সিটের অবস্থা পাঠানো
        socket.emit('current-room-state', roomState.seats);
        
        // বাকি সবাইকে জানানো যে নতুন কেউ এসেছে
        socket.broadcast.emit('user-joined-notification', username);
    });

    // ২. সিটে বসা বা নামার রিয়েল-টাইম আপডেট
    socket.on('toggle-seat', (seatId) => {
        const user = roomState.users[socket.id];
        if (!user) return;

        if (roomState.seats[seatId] === socket.id) {
            // সিট থেকে নেমে গেলে
            delete roomState.seats[seatId];
            user.seatId = null;
            io.emit('seat-updated', { seatId: seatId, username: null, action: 'leave' });
        } else {
            // খালি সিটে বসলে
            // চেক করা হচ্ছে ইউজার অলরেডি অন্য সিটে আছে কিনা
            const alreadySeated = Object.values(roomState.seats).includes(socket.id);
            if (alreadySeated) {
                socket.emit('error-msg', 'আপনি অলরেডি একটি সিটে আছেন!');
                return;
            }

            roomState.seats[seatId] = socket.id;
            user.seatId = seatId;
            io.emit('seat-updated', { seatId: seatId, username: user.username, action: 'sit' });
        }
    });

    // ৩. রিয়েল-টাইম চ্যাট মেসেজ আদান-প্রদান
    socket.on('send-chat-message', (messageText) => {
        const user = roomState.users[socket.id];
        if (user) {
            io.emit('receive-chat-message', {
                username: user.username,
                text: messageText
            });
        }
    });

    // ৪. সিটের ওপর ইমোজি উড়ানোর আপডেট
    socket.on('send-emoji', (emoji) => {
        const user = roomState.users[socket.id];
        if (user && user.seatId) {
            io.emit('receive-emoji', {
                seatId: user.seatId,
                emoji: emoji
            });
        }
    });

    // ৫. গিফট বা কয়েন পাঠানোর আপডেট
    socket.on('send-gift', (giftName) => {
        const user = roomState.users[socket.id];
        if (user) {
            io.emit('receive-gift', {
                username: user.username,
                giftName: giftName
            });
        }
    });

    // ৬. অডিও ভয়েস স্ট্রিম পাসিং (WebRTC / Audio Chunk Transfer)
    socket.on('audio-stream', (audioData) => {
        const user = roomState.users[socket.id];
        // যদি ইউজার কোনো সিটে থাকে এবং মিউট না থাকে, তবেই তার ভয়েস বাকিদের কাছে যাবে
        if (user && user.seatId) {
            socket.broadcast.emit('receive-audio-stream', {
                senderId: socket.id,
                audio: audioData
            });
        }
    });

    // ৭. ইউজার ডিসকানেক্ট বা রুম থেকে বের হয়ে গেলে
    socket.on('disconnect', () => {
        const user = roomState.users[socket.id];
        if (user) {
            console.log(`${user.username} ডিসকানেক্ট হয়েছে।`);
            
            // যদি সে কোনো সিটে বসে থাকতো, তবে সিট খালি করে দেওয়া
            if (user.seatId) {
                delete roomState.seats[user.seatId];
                io.emit('seat-updated', { seatId: user.seatId, username: null, action: 'leave' });
            }
            
            io.emit('user-left-notification', user.username);
            delete roomState.users[socket.id];
        }
    });
});

// সার্ভার লিসেনিং
server.listen(PORT, () => {
    console.log(`Sathi Audio Live সার্ভার চলছে পোর্ট: ${PORT}-এ`);
});
