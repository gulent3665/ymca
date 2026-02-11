require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB connected"))
.catch(err => console.log(err));

// User model
const User = mongoose.model("User", {
  username: String,
  password: String
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use(session({
  secret: "supersecretkey",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: { maxAge: 1000 * 60 * 60 }
}));

// Middleware to protect chat
function auth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  next();
}

// Routes

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
  res.redirect("/chat.html");
});

app.get("/chat", auth, (req, res) => {
  res.sendFile(__dirname + "/public/chat.html");
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login.html");
});

// Socket.io
io.on("connection", (socket) => {
  socket.on("chat message", (msg) => {
    io.emit("chat message", msg);
  });
});

server.listen(PORT, () => {
  console.log("Server running");
});
