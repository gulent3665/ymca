const express = require("express");
const sharedsession = require("express-socket.io-session");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { Server } = require("socket.io");
const multer = require("multer");
const { Dropbox } = require("dropbox");
const fetch = require("node-fetch");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

/* ===============================
   Dropbox + Upload Setup
=================================*/

const upload = multer({ storage: multer.memoryStorage() });

const dbx = new Dropbox({
  accessToken: process.env.DROPBOX_TOKEN
});

/* ===============================
   MongoDB Connection
=================================*/

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB connected"))
.catch(err => console.log(err));

/* ===============================
   Models
=================================*/

const User = mongoose.model("User", {
  username: String,
  password: String,
  avatar: String,
  profileComplete: { type: Boolean, default: false }
});

const Message = mongoose.model("Message", {
  user: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
});

/* ===============================
   Middleware
=================================*/

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const sessionMiddleware = session({
  secret: "supersecretkey",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: { maxAge: 1000 * 60 * 60 }
});

app.use(sessionMiddleware);
io.use(sharedsession(sessionMiddleware, { autoSave: true }));

function auth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  next();
}

/* ===============================
   Auth Routes
=================================*/

app.post("/register", async (req, res) => {
  const hashed = await bcrypt.hash(req.body.password, 10);

  await User.create({
    username: req.body.username,
    password: hashed
  });

  res.redirect("/login.html");
});

app.post("/login", async (req, res) => {
  const user = await User.findOne({ username: req.body.username });
  if (!user) return res.send("User not found");

  const valid = await bcrypt.compare(req.body.password, user.password);
  if (!valid) return res.send("Wrong password");

  req.session.user = user.username;

  if (!user.profileComplete) {
    return res.redirect("/profile");
  }

  res.redirect("/chat");
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login.html");
});

/* ===============================
   Profile Setup
=================================*/

app.get("/profile", auth, (req, res) => {
  res.sendFile(__dirname + "/public/profile.html");
});

app.post("/upload-profile", auth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("No file");

    const dropboxPath = `/avatars/${req.session.user}.png`;

    // Upload or overwrite file
    await dbx.filesUpload({
      path: dropboxPath,
      contents: req.file.buffer,
      mode: { ".tag": "overwrite" }
    });

    let link;

    try {
      // Try creating new shared link
      link = await dbx.sharingCreateSharedLinkWithSettings({
        path: dropboxPath
      });
    } catch (err) {
      // If link already exists, get existing one
      const existing = await dbx.sharingListSharedLinks({
        path: dropboxPath,
        direct_only: true
      });

      link = { result: existing.result.links[0] };
    }

    const url = link.result.url
      .replace("www.dropbox.com", "dl.dropboxusercontent.com")
      .replace("?dl=0", "");


    await User.updateOne(
      { username: req.session.user },
      { avatar: url, profileComplete: true }
    );

    res.json({ success: true });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).send("Upload failed");
  }
});


/* ===============================
   Chat Routes
=================================*/

app.get("/chat", auth, (req, res) => {
  res.sendFile(__dirname + "/public/chat.html");
});

app.get("/", (req, res) => {
  if (req.session.user) {
    res.redirect("/chat");
  } else {
    res.redirect("/login.html");
  }
});

/* ===============================
   Socket.io
=================================*/

io.on("connection", (socket) => {
  const user = socket.handshake.session.user || "Unknown";

  // Send previous messages
  Message.find().sort({ timestamp: 1 }).then(async (msgs) => {
    for (let msg of msgs) {
      const userData = await User.findOne({ username: msg.user });

      socket.emit("chat message", {
        user: msg.user,
        text: msg.text,
        avatar: userData?.avatar || null
      });
    }
  });

  socket.on("chat message", async (msgText) => {
    const userData = await User.findOne({ username: user });

    const msg = await Message.create({
      user: user,
      text: msgText
    });

    io.emit("chat message", {
      user: msg.user,
      text: msg.text,
      avatar: userData?.avatar || null
    });
  });
});

/* ===============================
   Start Server
=================================*/

server.listen(PORT, () => {
  console.log("Server running");
});
